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

    const { initScheduler } = await import('./lib/scheduledTasks/scheduler');
    await initScheduler();
  }
}
