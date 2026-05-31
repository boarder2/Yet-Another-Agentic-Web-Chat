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
 * Rewrites runStatus='running' to 'interrupted' in assistant message metadata.
 */
async function bootSweep(): Promise<void> {
  try {
    // Clear stale activeRunMessageId markers on chats
    const staleChats = await db
      .select({ id: chats.id, activeRunMessageId: chats.activeRunMessageId })
      .from(chats)
      .where(isNotNull(chats.activeRunMessageId));

    if (staleChats.length > 0) {
      await db
        .update(chats)
        .set({
          activeRunMessageId: null,
          activeRunStartedAt: null,
          lastRunStatus: 'interrupted',
          lastRunViewed: 0,
        })
        .where(isNotNull(chats.activeRunMessageId))
        .execute();

      // Rewrite runStatus='running' → 'interrupted' for any assistant row in
      // those chats. activeRunMessageId stores the human msg ID (hub key), so
      // we query all messages for the chat and patch any with runStatus='running'.
      for (const chat of staleChats) {
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

      console.log(
        `[bootSweep] cleared ${staleChats.length} stale run marker(s)`,
      );
    }
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
