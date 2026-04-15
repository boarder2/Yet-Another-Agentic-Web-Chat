import { CronJob, validateCronExpression } from 'cron';
import db from '@/lib/db';
import { scheduledTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { runScheduledTask } from './runner';

type Registry = {
  jobs: Map<string, CronJob>;
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

  const rows = await db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.enabled, 1));
  for (const task of rows) registerTask(task);
  console.log(`[scheduledTasks] registered ${rows.length} tasks`);
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
