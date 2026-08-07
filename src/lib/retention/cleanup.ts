import db, { sqlite } from '@/lib/db';
import { chats, schedules } from '@/lib/db/schema';
import { deleteCheckpoint } from '@/lib/runs/checkpointer';
import { and, eq, isNull, isNotNull, desc, sql, inArray } from 'drizzle-orm';
import type { RetentionPolicy } from '@/lib/config';
import {
  getChatRetentionPolicy,
  getScheduledRunRetentionPolicy,
} from '@/lib/settings/server';
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
  scheduleIdFilter?: string | null; // null = no scheduleId, string = specific id, undefined = any
  cutoffMs: number;
}): Promise<string[]> {
  const { scheduleIdFilter, cutoffMs } = params;
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.pinned, 0),
        sql`${chats.createdAt} < ${cutoffMs}`,
        scheduleIdFilter === undefined
          ? undefined
          : scheduleIdFilter === null
            ? isNull(chats.scheduleId)
            : eq(chats.scheduleId, scheduleIdFilter),
      ),
    );
  return rows.map((r) => r.id);
}

async function idsBeyondCount(params: {
  scheduleIdFilter: string | null;
  keepN: number;
}): Promise<string[]> {
  const { scheduleIdFilter, keepN } = params;
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.pinned, 0),
        scheduleIdFilter === null
          ? isNull(chats.scheduleId)
          : eq(chats.scheduleId, scheduleIdFilter),
      ),
    )
    .orderBy(desc(chats.createdAt));
  return rows.slice(keepN).map((r) => r.id);
}

async function purgeByPolicy(
  policy: RetentionPolicy,
  scheduleIdFilter: string | null,
): Promise<{ deleted: number }> {
  if (policy.mode === 'disabled') return { deleted: 0 };

  let ids: string[] = [];
  if (policy.mode === 'days') {
    ids = await idsOlderThan({
      scheduleIdFilter,
      cutoffMs: Date.now() - policy.value * MS_PER_DAY,
    });
  } else if (policy.mode === 'count') {
    ids = await idsBeyondCount({ scheduleIdFilter, keepN: policy.value });
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

  // Phase 2: scheduled-run retention per schedule
  const scheduleRows = await db.select().from(schedules);
  for (const schedule of scheduleRows) {
    const policy = resolveTaskRetentionPolicy(schedule);
    const { deleted } = await purgeByPolicy(policy, schedule.id);
    summary.scheduledRunsDeleted += deleted;
  }
  console.log(
    `[retention] scheduled-runs: deleted ${summary.scheduledRunsDeleted} across ${scheduleRows.length} schedules`,
  );

  // Phase 2b: orphan scheduled-run chats (schedule no longer exists) → global scheduled-run policy
  const existingScheduleIds = new Set(scheduleRows.map((s) => s.id));
  const orphanCandidates = await db
    .select({ id: chats.id, scheduleId: chats.scheduleId })
    .from(chats)
    .where(isNotNull(chats.scheduleId));
  const orphanIds = orphanCandidates
    .filter((c) => c.scheduleId && !existingScheduleIds.has(c.scheduleId))
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

  // Phase 4: run_events + LangGraph checkpoint GC.
  // - Orphaned run_events: a message regenerate deletes message rows but not
  //   run_events (which key on the user messageId, not a message FK).
  // - Orphaned checkpoints: any thread_id not pinned by chats.activeRunThreadId
  //   (completed/errored runs delete their own checkpoint; this catches leaks
  //   from crashes or non-clean exits).
  try {
    const orphanEvents = sqlite
      .prepare(
        `DELETE FROM run_events WHERE message_id NOT IN (SELECT messageId FROM messages)`,
      )
      .run();
    if (orphanEvents.changes > 0) {
      console.log(
        `[retention] run_events: deleted ${orphanEvents.changes} orphan(s)`,
      );
    }
  } catch (err) {
    console.warn('[retention] run_events GC failed:', err);
  }

  try {
    // The saver creates its tables lazily at boot, so on a DB that has never
    // initialized one there is nothing to collect.
    const hasCheckpoints = sqlite
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'`,
      )
      .get();
    if (hasCheckpoints) {
      const pinnedRows = sqlite
        .prepare(
          `SELECT active_run_thread_id AS t FROM chats WHERE active_run_thread_id IS NOT NULL`,
        )
        .all() as Array<{ t: string }>;
      const pinned = new Set(pinnedRows.map((r) => r.t));
      const threadRows = sqlite
        .prepare(`SELECT DISTINCT thread_id AS t FROM checkpoints`)
        .all() as Array<{ t: string }>;
      let gc = 0;
      for (const { t } of threadRows) {
        if (!pinned.has(t)) {
          await deleteCheckpoint(t).catch(() => {});
          gc += 1;
        }
      }
      if (gc > 0)
        console.log(`[retention] checkpoints: deleted ${gc} unpinned`);
    }
  } catch (err) {
    console.warn('[retention] checkpoint GC failed:', err);
  }

  console.log('[retention] summary:', summary);
  return summary;
}
