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

    const { initScheduler } = await import('./lib/scheduledTasks/scheduler');
    await initScheduler();
  }
}
