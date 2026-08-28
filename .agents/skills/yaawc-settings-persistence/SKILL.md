---
name: yaawc-settings-persistence
description: Settings sync, model selection, config/DB boundary, encrypted credentials, and server-side reads.
---

# Settings & Persistence

## The split (read this first)

- **`config.toml` holds ONLY genuine infra** — Docker/code-execution config, `BASE_URL`/port, and the required encryption passphrase (`SECURITY.ENCRYPTION_PASSPHRASE`, which can't live inside the thing it protects). Never auto-generated: `src/lib/encryption.ts` derives the AES key from it via scrypt; if unset, credential storage is unavailable and `GET /api/config`'s `encryptionConfigured: false` drives a full-app blocking gate (`EncryptionGate`, wraps `RootLayout`) until the user sets it. Never overwrite an existing `config.toml`.
- **All credentials — MCP auth and provider/search API keys — live encrypted in the DB**, in a dedicated `credentials` table (`src/lib/credentials.ts`, AES-256-GCM via `src/lib/encryption.ts`), distinct from `app_settings`. `app_settings` is shipped verbatim to every client by `GET /api/settings`, so ciphertext must never land there.
- **Provider/search endpoint URLs are DB-backed too** (LM Studio, Custom OpenAI, SearXNG) — via the ordinary `MIGRATED_SETTING_KEYS`/localStorage-sync path below, unencrypted, same as `searchProvider`. They're non-secret, so they don't need the `credentials` table.
- Everything else is DB-backed (`app_settings` table) or **request-supplied**. Mapping provider endpoints, profiles, attribution, explicit enablement, public-service acknowledgement, saved-location opt-in, and cache controls are DB-backed; mapping is disabled by default.
- Non-secret, non-device settings sync **localStorage ⇄ DB**; the **DB is the durable source of truth**. Device-local UI prefs (theme, accent, bg, chat width) are excluded.

## Adding / changing a synced setting

1. **Add the localStorage key to `MIGRATED_SETTING_KEYS`** in `src/lib/settings/keys.ts`. This single allowlist (shared by client persist + the server route, so keep it dependency-free) is what makes a key DB-backed and cross-device. Keep using `useLocalStorage*` at call sites — they're unchanged; `persist.ts` intercepts writes.
2. If a value was previously read from `config.toml`, **seed it once** in `src/lib/settings/seed.ts` (first-boot migration of legacy config values into `app_settings`).
3. To read it **server-side**, add/extend a helper in `src/lib/settings/server.ts` (`getSettings([keys])` on hot paths; `getAllSettings()` otherwise; typed getters like `getSearchProviderSelection`). Booleans are stored as `'true'`/`'false'`.

**Do NOT migrate:** device-local UI prefs (`appTheme`, `userBg`, `userAccent`, `chatWidthWide`, `codeExecutionWarningAccepted`), legacy `perplexica_dashboard_*` keys. Secrets never go through `MIGRATED_SETTING_KEYS`/`app_settings` at all — see `credentials.ts` above, or the `yaawc-mcp-integration` skill for MCP auth.

## Sync layer — `src/lib/settings/persist.ts` (subtle; tread carefully)

- Patches **`Storage.prototype.setItem`/`removeItem` once** (NOT the `localStorage` instance — assigning to the exotic instance is silently dropped). Guards `this === window.localStorage` so `sessionStorage` writes never sync. Only allowlisted keys trigger a debounced PATCH (`FLUSH_DELAY_MS`).
- **Per-browser `settingsDbMigrated` marker** (itself NOT a migrated key): until set, the DB may be incomplete (seeded from config / written by another device but missing this browser's local-only keys), so hydration **MERGES** (server wins for keys it has; local-only keys backed up, never deleted). Once set, the server is authoritative and cross-device deletions propagate (`removeAbsent`).
- `hydrateSettingsFromDb()` runs once on startup (watchdog opens the gate if the fetch hangs). `resyncSettingsFromDb()` re-pulls on focus/visibility (throttled, single-flight). Pending/in-flight keys are always protected so a sync never clobbers a just-made local change. `pagehide` flushes with `keepalive`.
- **Hydration-gated consumers**: views that snapshot localStorage on mount and write state back (e.g. `useDashboard`) must wait for `isSettingsHydrated()` / `subscribeSettingsHydrated()` before persisting (stale-on-mount values would otherwise clobber newer DB values), and listen to `subscribeSettingsSynced()` to re-read after a later re-sync.

## Settings UI

One controlled `SettingsPanel` (`src/app/settings/SettingsPanel.tsx`) rendered on **two surfaces**:

- The `/settings` page — URL-driven `SectionKey` state, deep-link fallback.
- A **global modal** — `SettingsModalProvider` (mounted in `layout.tsx`) exposes `useSettingsModal().openSettings(section?)`. Entry points (sidebar/mobile gears, personalization/preset/persona pickers) **open the modal**, they do not navigate.

Sections live in `src/app/settings/sections/*`; section components in `src/app/settings/components/*`.

## Model selection

`ModelPicker` (`src/components/models/`) drives chat/system/embedding/memory model choice. Note:

- **Per-request composer choices** (chat/system model, selected prompts, vision) are NOT read server-side from `app_settings` — they remain **request parameters** so a live change takes effect immediately without a debounce-staleness race.
- **Ambient settings** (memory flags, personalization, `autoTitleEnabled`) ARE read server-side and are no longer sent in request bodies. `autoTitleEnabled` (instance-wide, **default `true`**) gates auto-generated chat titles; the chat route reads it via `getBooleanSetting(..., true)`.
- The **memory-processing model** and the **embedding model** have their OWN keys (`memoryModel*`, `embeddingModel*`), independent of the chat picker's `systemModel`.

Related: `yaawc-api-endpoints` (the `/api/settings` route), `yaawc-agent-panel` (`panelPresets`/`panelSelection` keys), `yaawc-dashboard-widgets` (`yaawc_dashboard_*` keys), `yaawc-database` (the `app_settings` schema), and mapping's client-safe `/api/maps/config`/cache boundaries. Mapping settings are restored in serial integration coverage so an enabled test provider cannot leak into another scenario.
