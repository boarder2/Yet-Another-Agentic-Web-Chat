import db from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { readLegacyMigratableConfig } from '@/lib/config';

/**
 * One-time migration: copy settings that historically lived in config.toml into
 * the DB-backed `app_settings` table. Runtime now reads these from the DB
 * (`src/lib/settings/server.ts`), but existing installs still carry the values
 * in their config.toml — this seeds them so nothing is lost on upgrade.
 *
 * Idempotent and safe to run on every boot: it only inserts keys that are not
 * already present in `app_settings`, so a value a user has since changed via the
 * Settings UI is never clobbered. Invoked from `instrumentation.ts` (Node
 * runtime) before the server starts handling requests.
 */
export function seedSettingsFromConfig(): void {
  const legacy = readLegacyMigratableConfig();
  const keys = Object.keys(legacy);
  if (keys.length === 0) return;

  const existing = new Set(
    db
      .select({ key: appSettings.key })
      .from(appSettings)
      .all()
      .map((row) => row.key),
  );

  const now = new Date();
  const toInsert = keys
    .filter((key) => !existing.has(key))
    .map((key) => ({ key, value: legacy[key], updatedAt: now }));

  if (toInsert.length === 0) return;

  db.transaction((tx) => {
    for (const row of toInsert) {
      tx.insert(appSettings).values(row).onConflictDoNothing().run();
    }
  });

  console.log(
    `[settings] Seeded ${toInsert.length} setting(s) from config.toml into the database: ${toInsert
      .map((r) => r.key)
      .join(', ')}`,
  );
}
