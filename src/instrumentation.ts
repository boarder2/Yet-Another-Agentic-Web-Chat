export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Seed config.toml → DB before anything reads settings. Fault-isolated: a
    // seeding failure (missing config.toml, locked DB, unapplied migration) must
    // not prevent the scheduler from starting — runtime getters fall back to
    // sensible defaults when a setting is unseeded.
    try {
      const { seedSettingsFromConfig } = await import('./lib/settings/seed');
      seedSettingsFromConfig();
    } catch (err) {
      console.error(
        '[settings] Failed to seed settings from config.toml:',
        err,
      );
    }

    // Move workspace file blobs off the legacy global-dedup layout. Fault-isolated:
    // it keeps the legacy tree and retries next boot rather than half-migrating.
    try {
      const { migrateWorkspaceBlobs } =
        await import('./lib/workspaces/migrateBlobs');
      migrateWorkspaceBlobs();
    } catch (err) {
      console.error('[workspaces] Failed to migrate file blobs:', err);
    }

    // Backfill sanitizedContent for pre-migration message rows. Fire-and-forget:
    // batched and restart-safe (src/lib/db/backfillSanitizedContent.ts), so it
    // must never block boot — a failure just leaves nulls for the next boot to
    // retry, and history search excludes null rows in the meantime.
    try {
      const { backfillSanitizedContent } =
        await import('./lib/db/backfillSanitizedContent');
      backfillSanitizedContent().catch((err) => {
        console.error('[history] Failed to backfill sanitizedContent:', err);
      });
    } catch (err) {
      console.error(
        '[history] Failed to start sanitizedContent backfill:',
        err,
      );
    }

    // Encryption-at-rest boot sequence. The passphrase is required and never
    // auto-generated — if it's unset, skip the migrations (nothing to encrypt
    // into) and log a single actionable warning; the app itself blocks usage
    // via the Settings UI gate until the user sets it. Each migration is
    // fault-isolated so a failure in one never blocks the other or the
    // scheduler from starting.
    try {
      const { isEncryptionConfigured } = await import('./lib/encryption');
      if (!isEncryptionConfigured()) {
        console.warn(
          '[encryption] No SECURITY.ENCRYPTION_PASSPHRASE set in config.toml — ' +
            'credential storage (provider/search API keys, MCP auth) is unavailable ' +
            'until one is configured.',
        );
      } else {
        try {
          const { migrateMcpAuth } = await import('./lib/mcp/migrateAuth');
          migrateMcpAuth();
        } catch (err) {
          console.error(
            '[mcp] Failed to migrate MCP auth to encrypted storage:',
            err,
          );
        }

        try {
          const { migrateLegacyCredentials } =
            await import('./lib/credentials');
          migrateLegacyCredentials();
        } catch (err) {
          console.error(
            '[credentials] Failed to migrate legacy credentials from config.toml:',
            err,
          );
        }
      }
    } catch (err) {
      console.error('[encryption] Failed to check encryption config:', err);
    }

    // Split legacy scheduled_tasks rows into workflows + schedules. Fault-
    // isolated: a failure leaves the legacy table intact for the next boot to
    // retry rather than half-migrating, and must not block the scheduler.
    try {
      const { migrateScheduledTasks } =
        await import('./lib/scheduledTasks/migrateScheduledTasks');
      migrateScheduledTasks();
    } catch (err) {
      console.error(
        '[scheduledTasks] Failed to migrate legacy tasks to workflows:',
        err,
      );
    }

    const { initScheduler } = await import('./lib/scheduledTasks/scheduler');
    await initScheduler();
  }
}
