---
name: settings-persistence
description: Use when working on app settings — adding/changing a setting, the config.toml-vs-DB split, the localStorage⇄DB sync layer, the SettingsPanel/settings modal, model selection (ModelPicker), or reading settings server-side. Covers MIGRATED_SETTING_KEYS, persist.ts, settings/server.ts, and the seed-from-config flow.
---

# Settings & Persistence

## The split (read this first)

- **`config.toml` holds ONLY secrets/infra** — API keys, DB, SearXNG URL, code-execution. **No model selection or behavior settings live there.** Never overwrite an existing `config.toml`.
- **Everything else is DB-backed** (`app_settings` table) or **request-supplied**.
- Non-secret, non-device settings sync **localStorage ⇄ DB**; the **DB is the durable source of truth**. Device-local UI prefs (theme, accent, bg, chat width) and secrets are excluded.

## Adding / changing a synced setting

1. **Add the localStorage key to `MIGRATED_SETTING_KEYS`** in `src/lib/settings/keys.ts`. This single allowlist (shared by client persist + the server route, so keep it dependency-free) is what makes a key DB-backed and cross-device. Keep using `useLocalStorage*` at call sites — they're unchanged; `persist.ts` intercepts writes.
2. If a value was previously read from `config.toml`, **seed it once** in `src/lib/settings/seed.ts` (first-boot migration of legacy config values into `app_settings`).
3. To read it **server-side**, add/extend a helper in `src/lib/settings/server.ts` (`getSettings([keys])` on hot paths; `getAllSettings()` otherwise; typed getters like `getSearchProviderSelection`). Booleans are stored as `'true'`/`'false'`.

**Do NOT migrate:** secrets (`openAIApiKey`, base URLs → config.toml), device-local UI prefs (`appTheme`, `userBg`, `userAccent`, `chatWidthWide`, `codeExecutionWarningAccepted`), legacy `perplexica_dashboard_*` keys.

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
- **Ambient settings** (memory flags, personalization) ARE read server-side and are no longer sent in request bodies.
- The **memory-processing model** and the **embedding model** have their OWN keys (`memoryModel*`, `embeddingModel*`), independent of the chat picker's `systemModel`.

Related: `api-endpoints` (the `/api/settings` route), `agent-panel` (`panelPresets`/`panelSelection` keys), `dashboard-widgets` (`yaawc_dashboard_*` keys), `db-migrations` (the `app_settings` schema).
