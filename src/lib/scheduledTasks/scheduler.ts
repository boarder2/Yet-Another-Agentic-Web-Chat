import { CronJob, validateCronExpression } from 'cron';
import db from '@/lib/db';
import {
  chats,
  messages as messagesSchema,
  scheduledTasks,
} from '@/lib/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import { runScheduledTask } from './runner';
import { runRetentionCleanup } from '@/lib/retention/cleanup';
import { gcRuns } from '@/lib/runs/runHub';
import {
  initLanggraphCheckpointer,
  deleteCheckpoint,
} from '@/lib/runs/checkpointer';
import { markOpenApprovalsInterrupted } from '@/lib/runs/runHost';

type Registry = {
  jobs: Map<string, CronJob>;
  privateCleanupJob?: CronJob;
};

declare global {
  var __scheduledTaskRegistry: Registry | undefined;
}

function getRegistry(): Registry {
  if (!globalThis.__scheduledTaskRegistry) {
    globalThis.__scheduledTaskRegistry = {
      jobs: new Map(),
    };
  }
  return globalThis.__scheduledTaskRegistry;
}

export async function initScheduler() {
  const reg = getRegistry();
  // On HMR re-run, stop & clear any previously registered jobs.
  for (const job of reg.jobs.values()) job.stop();
  reg.jobs.clear();
  reg.privateCleanupJob?.stop();
  reg.privateCleanupJob = undefined;

  // Initialize LangGraph checkpointer (idempotent setup of checkpoint tables)
  initLanggraphCheckpointer();

  // Boot sweep: clear stale run markers from a previous server process
  await bootSweep();

  const rows = await db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.enabled, 1));
  for (const task of rows) registerTask(task);
  console.log(`[scheduledTasks] registered ${rows.length} tasks`);

  reg.privateCleanupJob = CronJob.from({
    cronTime: '*/5 * * * *',
    onTick: async () => {
      try {
        await runRetentionCleanup();
        gcRuns();
      } catch (err) {
        console.error('[retention] cron failed:', err);
      }
    },
    start: true,
    waitForCompletion: true,
  });
}

/**
 * On server start, clear any stale run markers left by a previous process.
 * - `awaiting_user` runs: preserved (checkpoint persisted, lazily reconstructed on subscribe/resume).
 * - `running` (or missing activeRunStatus): marked interrupted, checkpoint deleted.
 */
async function bootSweep(): Promise<void> {
  try {
    const allActive = await db
      .select({
        id: chats.id,
        activeRunMessageId: chats.activeRunMessageId,
        activeRunStatus: chats.activeRunStatus,
        activeRunThreadId: chats.activeRunThreadId,
      })
      .from(chats)
      .where(isNotNull(chats.activeRunMessageId));

    if (allActive.length === 0) return;

    const toInterrupt = allActive.filter(
      (c) => c.activeRunStatus !== 'awaiting_user',
    );
    const awaitingCount = allActive.length - toInterrupt.length;

    if (toInterrupt.length > 0) {
      for (const chat of toInterrupt) {
        await db
          .update(chats)
          .set({
            activeRunMessageId: null,
            activeRunStartedAt: null,
            activeRunStatus: null,
            activeRunThreadId: null,
            activeRunConfigSnapshot: null,
            lastRunStatus: 'interrupted',
            lastRunViewed: 0,
          })
          .where(eq(chats.id, chat.id))
          .execute();

        if (chat.activeRunMessageId) {
          await markOpenApprovalsInterrupted(chat.activeRunMessageId).catch(
            (e: unknown) =>
              console.warn('[bootSweep] markInterrupted failed:', e),
          );
        }
        if (chat.activeRunThreadId) {
          await deleteCheckpoint(chat.activeRunThreadId).catch((e: unknown) =>
            console.warn('[bootSweep] deleteCheckpoint failed:', e),
          );
        }

        // Rewrite runStatus='running' → 'interrupted' in message metadata
        const msgRows = await db.query.messages.findMany({
          where: eq(messagesSchema.chatId, chat.id),
        });
        for (const row of msgRows) {
          try {
            const meta = JSON.parse((row.metadata as string) || '{}') as Record<
              string,
              unknown
            >;
            if (meta.runStatus === 'running') {
              meta.runStatus = 'interrupted';
              await db
                .update(messagesSchema)
                .set({ metadata: JSON.stringify(meta) })
                .where(eq(messagesSchema.messageId, row.messageId))
                .execute();
            }
          } catch (err) {
            console.warn('[bootSweep] metadata rewrite failed:', err);
          }
        }
      }
    }

    console.log(
      `[bootSweep] cleared ${toInterrupt.length} stale run(s), preserved ${awaitingCount} awaiting_user run(s)`,
    );
  } catch (err) {
    console.error('[bootSweep] failed:', err);
  }
}

export function registerTask(task: typeof scheduledTasks.$inferSelect) {
  const reg = getRegistry();
  if (!validateCronExpression(task.cronExpression).valid) {
    console.error(
      `[scheduledTasks] invalid cron for ${task.id}: ${task.cronExpression}`,
    );
    return;
  }
  // Replace existing job for this id.
  reg.jobs.get(task.id)?.stop();

  const job = CronJob.from({
    cronTime: task.cronExpression,
    onTick: async () => {
      try {
        await runScheduledTask(task.id);
      } catch (err) {
        console.error(`[scheduledTasks] run failed for ${task.id}:`, err);
      }
    },
    start: true,
    timeZone: task.timezone ?? undefined,
    waitForCompletion: true,
  });
  reg.jobs.set(task.id, job);
}

export function unregisterTask(id: string) {
  const reg = getRegistry();
  reg.jobs.get(id)?.stop();
  reg.jobs.delete(id);
}

export function rescheduleTask(task: typeof scheduledTasks.$inferSelect) {
  unregisterTask(task.id);
  if (task.enabled) registerTask(task);
}
