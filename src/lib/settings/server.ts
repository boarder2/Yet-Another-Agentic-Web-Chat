import db from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { getSelectedSystemModel } from '@/lib/config';

/**
 * Server-side reads of the database-backed settings (`app_settings`). These are
 * the authoritative source for *ambient* settings (memory, personalization) that
 * the UI no longer sends in request bodies. Values are the same serialized
 * strings the localStorage cache holds.
 *
 * Per-request composer choices (model selection, selected prompts, vision) are
 * intentionally NOT read here — they remain request parameters so a live choice
 * takes effect immediately without a debounce-staleness race.
 */
export function getAllSettings(): Record<string, string> {
  const rows = db.select().from(appSettings).all();
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/**
 * Read only the named settings. Prefer this on hot paths (e.g. every chat
 * request) so large values like the dashboard widget cache are never loaded
 * just to read a handful of memory/personalization flags.
 */
export function getSettings(keys: string[]): Record<string, string> {
  if (keys.length === 0) return {};
  const rows = db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, keys))
    .all();
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function getStringSetting(
  settings: Record<string, string>,
  key: string,
  fallback: string,
): string {
  const raw = settings[key];
  return raw ?? fallback;
}

/**
 * The memory-processing model selection (extract/dedup/classify/reindex). It is
 * its own DB-backed setting (`memoryModelProvider`/`memoryModel`), fully
 * independent of the chat picker's system model. Falls back to the legacy
 * config.toml `SELECTED_MODELS.SYSTEM_MODEL` for installs that predate the
 * DB-backed split and haven't re-saved the memory model yet. Returns empty
 * strings when neither is set, so callers fall back to a default model.
 */
export function getMemoryModelSelection(): { provider: string; name: string } {
  const s = getSettings(['memoryModelProvider', 'memoryModel']);
  const provider = s['memoryModelProvider'];
  const name = s['memoryModel'];
  if (provider && name) return { provider, name };
  return getSelectedSystemModel();
}

/** Booleans are stored as `'true'`/`'false'`, matching the client cache. */
export function getBooleanSetting(
  settings: Record<string, string>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = settings[key];
  if (raw === undefined) return fallback;
  return raw === 'true';
}
