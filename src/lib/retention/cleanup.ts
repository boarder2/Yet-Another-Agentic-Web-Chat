import db from '@/lib/db';
import { chats, scheduledTasks } from '@/lib/db/schema';
import { and, eq, isNull, isNotNull, desc, sql, inArray } from 'drizzle-orm';
import {
  getChatRetentionPolicy,
  getScheduledRunRetentionPolicy,
  type RetentionPolicy,
} from '@/lib/config';
import { cleanupExpiredPrivateSessions } from '@/lib/privateSessionCleanup';
import { resolveTaskRetentionPolicy } from './policy';
import { deleteChatWithOrphanCleanup } from './deleteChat';

export type RetentionSummary = {
  privateSessions: number;
  scheduledRunsDeleted: number;
  regularChatsDeleted: number;
  pinnedSkipped: number;
};

const MS_PER_DAY = 86_400_000;

async function idsOlderThan(params: {
  taskIdFilter?: string | null; // null = no scheduledTaskId, string = specific id, undefined = any
  cutoffMs: number;
}): Promise<string[]> {
  const { taskIdFilter, cutoffMs } = params;
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.pinned, 0),
        sql`${chats.createdAt} < ${cutoffMs}`,
        taskIdFilter === undefined
          ? undefined
          : taskIdFilter === null
            ? isNull(chats.scheduledTaskId)
            : eq(chats.scheduledTaskId, taskIdFilter),
      ),
    );
  return rows.map((r) => r.id);
}

async function idsBeyondCount(params: {
  taskIdFilter: string | null;
  keepN: number;
}): Promise<string[]> {
  const { taskIdFilter, keepN } = params;
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.pinned, 0),
        taskIdFilter === null
          ? isNull(chats.scheduledTaskId)
          : eq(chats.scheduledTaskId, taskIdFilter),
      ),
    )
    .orderBy(desc(chats.createdAt));
  return rows.slice(keepN).map((r) => r.id);
}

async function purgeByPolicy(
  policy: RetentionPolicy,
  taskIdFilter: string | null,
): Promise<{ deleted: number }> {
  if (policy.mode === 'disabled') return { deleted: 0 };

  let ids: string[] = [];
  if (policy.mode === 'days') {
    ids = await idsOlderThan({
      taskIdFilter,
      cutoffMs: Date.now() - policy.value * MS_PER_DAY,
    });
  } else if (policy.mode === 'count') {
    ids = await idsBeyondCount({ taskIdFilter, keepN: policy.value });
  }

  for (const id of ids) {
    deleteChatWithOrphanCleanup(id);
    console.log(`[retention] deleted chat ${id}`);
  }
  return { deleted: ids.length };
}

export async function runRetentionCleanup(): Promise<RetentionSummary> {
  const summary: RetentionSummary = {
    privateSessions: 0,
    scheduledRunsDeleted: 0,
    regularChatsDeleted: 0,
    pinnedSkipped: 0,
  };

  // Phase 1: private sessions (existing behavior)
  try {
    summary.privateSessions = await cleanupExpiredPrivateSessions();
  } catch (err) {
    console.error('[retention] private-sessions phase failed:', err);
  }

  // Phase 2: scheduled-run retention per task
  const tasks = await db.select().from(scheduledTasks);
  for (const task of tasks) {
    const policy = resolveTaskRetentionPolicy(task);
    const { deleted } = await purgeByPolicy(policy, task.id);
    summary.scheduledRunsDeleted += deleted;
  }
  console.log(
    `[retention] scheduled-runs: deleted ${summary.scheduledRunsDeleted} across ${tasks.length} tasks`,
  );

  // Phase 2b: orphan scheduled-run chats (task no longer exists) → global scheduled-run policy
  const existingTaskIds = new Set(tasks.map((t) => t.id));
  const orphanCandidates = await db
    .select({ id: chats.id, scheduledTaskId: chats.scheduledTaskId })
    .from(chats)
    .where(isNotNull(chats.scheduledTaskId));
  const orphanIds = orphanCandidates
    .filter((c) => c.scheduledTaskId && !existingTaskIds.has(c.scheduledTaskId))
    .map((c) => c.id);

  if (orphanIds.length > 0) {
    const globalSchedPolicy = getScheduledRunRetentionPolicy();
    if (globalSchedPolicy.mode !== 'disabled') {
      const orphanRows = await db
        .select({
          id: chats.id,
          createdAt: chats.createdAt,
          pinned: chats.pinned,
        })
        .from(chats)
        .where(and(inArray(chats.id, orphanIds), eq(chats.pinned, 0)));

      let toDelete: string[] = [];
      if (globalSchedPolicy.mode === 'days') {
        const cutoff = Date.now() - globalSchedPolicy.value * MS_PER_DAY;
        toDelete = orphanRows
          .filter((r) => r.createdAt < cutoff)
          .map((r) => r.id);
      } else if (globalSchedPolicy.mode === 'count') {
        const sorted = [...orphanRows].sort(
          (a, b) => b.createdAt - a.createdAt,
        );
        toDelete = sorted.slice(globalSchedPolicy.value).map((r) => r.id);
      }

      for (const id of toDelete) {
        deleteChatWithOrphanCleanup(id);
        console.log(`[retention] deleted orphan scheduled-run chat ${id}`);
        summary.scheduledRunsDeleted += 1;
      }
    }
  }

  // Phase 3: regular chats (scheduledTaskId IS NULL)
  const globalChatPolicy = getChatRetentionPolicy();
  const { deleted: regular } = await purgeByPolicy(globalChatPolicy, null);
  summary.regularChatsDeleted = regular;
  console.log(`[retention] regular-chats: deleted ${regular}`);

  console.log('[retention] summary:', summary);
  return summary;
}
