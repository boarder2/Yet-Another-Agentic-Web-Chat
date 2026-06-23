/**
 * The allowlist of settings keys that are persisted to the database
 * (`app_settings` table) and synchronized across devices. Everything here was
 * historically stored only in browser localStorage.
 *
 * Shared by both the client persistence layer (`src/lib/settings/persist.ts`)
 * and the server API route (`src/app/api/settings/route.ts`), so this module
 * must stay free of client-only or server-only dependencies.
 *
 * Deliberately NOT migrated (stay local / elsewhere):
 * - Secrets: `openAIApiKey`, `openAIBaseURL` — live in config.toml.
 * - Device-local UI prefs: `appTheme`, `userBg`, `userAccent`, `chatWidthWide`,
 *   `codeExecutionWarningAccepted`.
 * - Legacy `perplexica_dashboard_*` keys (handled by a separate one-shot
 *   localStorage migration).
 */
export const MIGRATED_SETTING_KEYS = [
  // Model selection
  'chatModelProvider',
  'chatModel',
  'systemModelProvider',
  'systemModel',
  'imageCapable',
  'contextWindowSize',
  'embeddingModelProvider',
  'embeddingModel',
  'modelPresets',
  // Agent panel: saved presets sync cross-device like model presets; the active
  // composer selection rides along so an enabled panel survives device switches.
  'panelPresets',
  'panelSelection',
  'searchChatModelProvider',
  'searchChatModel',
  // Memory + personalization
  'memoryEnabled',
  'memoryRetrievalEnabled',
  'memoryAutoDetectionEnabled',
  // Memory-processing model — the model used by memory extraction/dedup/
  // classification/reindex. Deliberately its OWN keys (NOT the chat picker's
  // `systemModel`/`systemModelProvider`), so the two are fully independent.
  'memoryModelProvider',
  'memoryModel',
  'personalization.location',
  'personalization.about',
  'personalization.sendLocationEnabled',
  'personalization.sendProfileEnabled',
  // Behavior / composer
  'autoSuggestions',
  'selectedSystemPromptIds',
  'selectedMethodologyId',
  // Chat & scheduled-run retention policies (instance-wide). Seeded once from
  // the legacy config.toml `[GENERAL.RETENTION]` block.
  'retentionChatsMode',
  'retentionChatsValue',
  'retentionScheduledRunsMode',
  'retentionScheduledRunsValue',
  // Search provider + locale preferences (instance-wide). The provider API keys
  // and the SearXNG URL stay in config.toml (secrets/infra). Seeded once from
  // the legacy config.toml `[SEARCH]` block.
  'searchProvider',
  'searchPrivateProvider',
  'searchFallbackProvider',
  'searchLanguage',
  'searchRegion',
  // Hidden models (model-visibility). Seeded once from legacy
  // config.toml `GENERAL.HIDDEN_MODELS`.
  'hiddenModels',
  // Image generation tool settings. The OpenRouter API key stays in config.toml.
  // Seeded once from the legacy config.toml `[TOOLS.IMAGE_GENERATION]` block.
  'imageGenerationEnabled',
  'imageGenerationProvider',
  'imageGenerationModel',
  'imageGenerationAspectRatio',
  'imageGenerationImageSize',
  // Text-to-speech
  'ttsVoice',
  'ttsEngine',
  'ttsSpeed',
  'ttsNarrationMode',
  'ttsNarrationProvider',
  'ttsNarrationModel',
  'ttsAutoplay',
  // Dashboard. The rendered-widget cache is synced too so a widget rendered on
  // one device isn't re-rendered on another until its stored expiry — staleness
  // is data-driven (each entry carries its own `expiresAt`), so it travels
  // safely across devices.
  'yaawc_dashboard_widgets',
  'yaawc_dashboard_settings',
  'yaawc_dashboard_layouts',
  'yaawc_dashboard_cache',
] as const;

export type MigratedSettingKey = (typeof MIGRATED_SETTING_KEYS)[number];

const MIGRATED_SETTING_KEY_SET: ReadonlySet<string> = new Set(
  MIGRATED_SETTING_KEYS,
);

/** Whether a given localStorage key is database-backed (and cross-device). */
export function isMigratedSettingKey(key: string): key is MigratedSettingKey {
  return MIGRATED_SETTING_KEY_SET.has(key);
}
