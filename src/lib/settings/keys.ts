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
 * - Secrets: all provider/search API keys and MCP auth — encrypted in the
 *   dedicated `credentials` table (`src/lib/credentials.ts`), never here,
 *   since this table is shipped verbatim to every client.
 * - Device-local UI prefs: `appTheme`, `customTheme`, `appThemeCache`,
 *   `chatWidthWide`, `codeExecutionWarningAccepted`. Theme stays local because
 *   lighting differs per device and this layer is last-write-wins, so two
 *   devices with different preferences would clobber each other; the Appearance
 *   section offers copy/paste instead.
 * - Legacy `perplexica_dashboard_*` keys (handled by a separate one-shot
 *   localStorage migration).
 */
export const CODE_EXECUTION_AUTO_RUN_SETTING_KEY = 'codeExecutionAutoRun';

export const MIGRATED_SETTING_KEYS = [
  // Model selection
  'chatModelProvider',
  'chatModel',
  'systemModelProvider',
  'systemModel',
  'chatReasoningEffort',
  'systemReasoningEffort',
  'imageCapable',
  'contextWindowSize',
  'embeddingModelProvider',
  'embeddingModel',
  'modelPresets',
  // OpenRouter routing preferences are instance-wide and sync across devices.
  'openrouterQuantizations',
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
  CODE_EXECUTION_AUTO_RUN_SETTING_KEY,
  'autoSuggestions',
  'autoTitleEnabled',
  'selectedSystemPromptIds',
  'selectedMethodologyId',
  // Chat & scheduled-run retention policies (instance-wide). Seeded once from
  // the legacy config.toml `[GENERAL.RETENTION]` block.
  'retentionChatsMode',
  'retentionChatsValue',
  'retentionScheduledRunsMode',
  'retentionScheduledRunsValue',
  // Private-session auto-delete duration (instance-wide). Seeded once from
  // legacy config.toml `GENERAL.PRIVATE_SESSION_DURATION_MINUTES`.
  'privateSessionDurationMinutes',
  // Search provider + locale preferences (instance-wide). The provider API
  // keys are encrypted in `credentials.ts`; the SearXNG URL is below (it's a
  // non-secret endpoint). Seeded once from the legacy config.toml `[SEARCH]`
  // block.
  'searchProvider',
  'searchPrivateProvider',
  'searchFallbackProvider',
  'searchLanguage',
  'searchRegion',
  // Hidden models (model-visibility). Seeded once from legacy
  // config.toml `GENERAL.HIDDEN_MODELS`.
  'hiddenModels',
  // Image generation tool settings. The OpenRouter API key is encrypted in
  // `credentials.ts`. Seeded once from the legacy config.toml
  // `[TOOLS.IMAGE_GENERATION]` block.
  'imageGenerationEnabled',
  'imageGenerationProvider',
  'imageGenerationModel',
  'imageGenerationAspectRatio',
  'imageGenerationImageSize',
  // Provider/search endpoint URLs (non-secret; the API keys they pair with
  // live in `credentials.ts`). Seeded once from legacy config.toml.
  'lmStudioApiUrl',
  'customOpenaiApiUrl',
  'customOpenaiModelName',
  'searxngApiUrl',
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
