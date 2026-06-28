import db from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import type {
  RetentionPolicy,
  SearchProviderIdType,
  ImageGenerationConfig,
} from '@/lib/config';

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
 * independent of the chat picker's system model. Returns empty strings when
 * unset, so callers fall back to a default model.
 */
export function getMemoryModelSelection(): { provider: string; name: string } {
  const s = getSettings(['memoryModelProvider', 'memoryModel']);
  return {
    provider: s['memoryModelProvider'] ?? '',
    name: s['memoryModel'] ?? '',
  };
}

/**
 * The embedding model selection, DB-backed under `embeddingModelProvider`/
 * `embeddingModel` (synced from the Settings → Model Settings UI). Returns empty
 * strings when unset, so callers fall back to the first available embedding model.
 */
export function getEmbeddingModelSelection(): {
  provider: string;
  name: string;
} {
  const s = getSettings(['embeddingModelProvider', 'embeddingModel']);
  return {
    provider: s['embeddingModelProvider'] ?? '',
    name: s['embeddingModel'] ?? '',
  };
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

// ---------------------------------------------------------------------------
// Instance-wide settings migrated out of config.toml into `app_settings`.
// These were once read from config.toml via `@/lib/config`; the values are now
// DB-backed (synced from the Settings UI) and seeded once from any legacy
// config.toml values on first server boot (`src/lib/settings/seed.ts`).
// ---------------------------------------------------------------------------

/** Chat retention policy. Seeded from legacy `GENERAL.RETENTION.CHATS_*`. */
export function getChatRetentionPolicy(): RetentionPolicy {
  const s = getSettings(['retentionChatsMode', 'retentionChatsValue']);
  const mode = s['retentionChatsMode'];
  const value = parseInt(s['retentionChatsValue'] ?? '', 10);
  return {
    mode:
      mode === 'days' || mode === 'count' || mode === 'disabled'
        ? mode
        : 'disabled',
    value: Number.isFinite(value) ? value : 365,
  };
}

/**
 * Scheduled-run retention policy (global default). Seeded from legacy
 * `GENERAL.RETENTION.SCHEDULED_RUNS_*`.
 */
export function getScheduledRunRetentionPolicy(): RetentionPolicy {
  const s = getSettings([
    'retentionScheduledRunsMode',
    'retentionScheduledRunsValue',
  ]);
  const mode = s['retentionScheduledRunsMode'];
  const value = parseInt(s['retentionScheduledRunsValue'] ?? '', 10);
  return {
    mode:
      mode === 'days' || mode === 'count' || mode === 'disabled'
        ? mode
        : 'disabled',
    value: Number.isFinite(value) ? value : 10,
  };
}

/** Search provider selection. Seeded from legacy `SEARCH.*_PROVIDER`. */
export function getSearchProviderSelection(): {
  provider: SearchProviderIdType;
  privateProvider: SearchProviderIdType | undefined;
  fallbackProvider: SearchProviderIdType;
} {
  const s = getSettings([
    'searchProvider',
    'searchPrivateProvider',
    'searchFallbackProvider',
  ]);
  return {
    provider: (s['searchProvider'] as SearchProviderIdType) || 'searxng',
    privateProvider:
      (s['searchPrivateProvider'] as SearchProviderIdType) || undefined,
    fallbackProvider:
      (s['searchFallbackProvider'] as SearchProviderIdType) || 'searxng',
  };
}

/** Search locale. Seeded from legacy `SEARCH.LANGUAGE`/`SEARCH.REGION`. */
export function getSearchLocale(): { language: string; region: string } {
  const s = getSettings(['searchLanguage', 'searchRegion']);
  return {
    language: s['searchLanguage'] || 'en',
    region: s['searchRegion'] ?? 'US',
  };
}

/** Hidden models list. Seeded from legacy `GENERAL.HIDDEN_MODELS`. */
export function getHiddenModels(): string[] {
  const raw = getSettings(['hiddenModels'])['hiddenModels'];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((m): m is string => typeof m === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Image generation tool config. Seeded from legacy `TOOLS.IMAGE_GENERATION`.
 * Never null (kept nullable for call-site compatibility with the old getter).
 */
export function getImageGenerationConfig(): ImageGenerationConfig | null {
  const s = getSettings([
    'imageGenerationEnabled',
    'imageGenerationProvider',
    'imageGenerationModel',
    'imageGenerationAspectRatio',
    'imageGenerationImageSize',
  ]);
  return {
    enabled: s['imageGenerationEnabled'] === 'true',
    provider: s['imageGenerationProvider'] || 'openrouter',
    model: s['imageGenerationModel'] || '',
    aspectRatio: s['imageGenerationAspectRatio'] || '1:1',
    imageSize: s['imageGenerationImageSize'] || '1K',
  };
}
