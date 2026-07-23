import { sqlite } from '@/lib/db';

/**
 * Boot migration: split each legacy `scheduled_tasks` row into a `workflow` +
 * one `schedule`, and remap scheduled-run chats onto the new `schedule_id`.
 *
 * Runs at startup (migrateBlobs pattern) rather than inside the Drizzle SQL
 * migration because the row-copy — folding `source_urls` into the prompt as an
 * editable placeholder — is awkward as pure generated DDL (§4.4 of the
 * workflows design). Idempotent: each task's id is reused for both its workflow
 * and schedule, so a row is skipped once its workflow already exists.
 *
 * The legacy `scheduled_tasks` table and `chats.scheduled_task_id` column are
 * retained (not dropped) — dropping them would be a destructive schema diff that
 * `drizzle-kit push` would fight. They sit empty of meaning after this runs.
 */
export function migrateScheduledTasks(): void {
  // Legacy table may not exist yet on a brand-new DB where migrations created
  // everything at once; nothing to migrate in that case.
  const hasTable = sqlite
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduled_tasks'`,
    )
    .get();
  if (!hasTable) return;

  const tasks = sqlite.prepare(`SELECT * FROM scheduled_tasks`).all() as Array<
    Record<string, unknown>
  >;
  if (tasks.length === 0) return;

  const alreadyMigrated = sqlite.prepare(
    `SELECT 1 FROM workflows WHERE id = ?`,
  );
  const insertWorkflow = sqlite.prepare(
    `INSERT INTO workflows (id, name, description, icon, prompt, focus_mode, chat_model, system_model, selected_system_prompt_ids, selected_methodology_id, created_at, updated_at)
     VALUES (@id, @name, NULL, NULL, @prompt, @focus_mode, @chat_model, @system_model, @selected_system_prompt_ids, @selected_methodology_id, @created_at, @updated_at)`,
  );
  const insertSchedule = sqlite.prepare(
    `INSERT INTO schedules (id, workflow_id, label, input_values, cron_expression, timezone, enabled, disabled_reason, last_run_at, last_run_status, last_run_error, last_run_chat_id, retention_mode, retention_value, created_at, updated_at)
     VALUES (@id, @id, @name, '{}', @cron_expression, @timezone, @enabled, NULL, @last_run_at, @last_run_status, @last_run_error, @last_run_chat_id, @retention_mode, @retention_value, @created_at, @updated_at)`,
  );
  const remapChats = sqlite.prepare(
    `UPDATE chats SET schedule_id = @id WHERE scheduled_task_id = @id AND schedule_id IS NULL`,
  );

  const run = sqlite.transaction(() => {
    let migrated = 0;
    for (const t of tasks) {
      if (alreadyMigrated.get(t.id)) continue;

      let prompt = String(t.prompt ?? '');
      const urls = parseUrls(t.source_urls);
      if (urls.length > 0) {
        prompt +=
          `\n\nPrioritize these sources:\n` +
          `{{sources?:longtext = ${urls.join(', ')}}}`;
      }

      insertWorkflow.run({ ...t, prompt });
      insertSchedule.run(t);
      remapChats.run({ id: t.id });
      migrated += 1;
    }
    return migrated;
  });

  const count = run();
  if (count > 0) {
    console.log(
      `[scheduledTasks] migrated ${count} legacy task(s) → workflows + schedules`,
    );
  }
}

function parseUrls(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
