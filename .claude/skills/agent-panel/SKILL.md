---
name: agent-panel
description: Use when working on the Agent Panel composer mode — fanning one prompt across 2–4 executor models in parallel then synthesizing one answer. Covers PanelCoordinator, panel executors, the restricted executor toolset, panel_executor_* events, PanelColumns markup, and panel presets/selection.
---

# Agent Panel

Panel is an optional **composer mode** (orthogonal to focus mode; research modes only) that runs the same user prompt across **2–4 executor models in parallel**, then has the **turn's chat model** synthesize one final answer from their results. There is **no separate synthesizer/orchestrator model** — the synthesizer is always `body.chatModel`. "Orchestrator" survives only as the internal name for the synthesis pass/prompt.

## Request contract

`body.panel: PanelConfig` (`src/lib/types/panel.ts`):

- `executors: PanelExecutorConfig[]` — each is a `ModelRef` (`provider` + `name` + optional `contextWindow`) plus optional `imageCapable`. **2–4 required**; enforce via `validatePanelConfig()` (returns a discriminated `{ ok }` result — guard on it both client- and server-side).
- An **absent** `panel` leaves the single-model path byte-for-byte unchanged.

## Two phases (wired in `src/app/api/chat/route.ts`, inside the `isNew` block)

Phase 1 runs only on a **new** message; **resume never re-runs Phase 1** (it reuses the ordinary agent runHost path).

1. **Phase 1 — `PanelCoordinator`** (`src/lib/search/panel/coordinator.ts`):
   - Resolves each executor with `resolveModelRef(ref, { isolate: true })` (own instance so concurrent runs can't clobber a shared catalog-cached singleton). Needs ≥2 resolvable models or it throws.
   - Runs each executor as a full `SimplifiedAgent` on an **isolated `EventEmitter`**, forwarding its stream to the parent as `panel_executor_*` events. This mirrors the `deep_research` subagent isolated-emitter pattern.
   - Executors get chat history + retrieved memory **and** the active persona/methodology (so each researches in the user's voice), but memory tools are off.
   - Toolset is the focus-mode toolset minus the prompting/mutating/recursive set (`filterExecutorTools`, see below).
   - After all settle (`Promise.allSettled`; `runOne` never throws), sources are merged + deduped into one ordered citation set with 1-based `sourceId`s. Dedup key: real `url`, else a meaningful `source` (NOT the `file_search` sentinel), else `title::pageContent`. If zero executors succeed, it throws.
   - Token usage is folded into the run via `handler.addInitialChatUsage` / `addInitialSystemUsage` (executor generation → chat tokens; their internal chains → system tokens).

2. **Phase 2 — synthesis**: the chat model runs as an **ordinary agent** (full tools, interrupts/resume unchanged) via `handler.searchAndAnswer(..., workspaceTools, mergedSources)`. The merged citation set is passed as `initialDocuments`; a synthesis `SystemMessage` from `buildOrchestratorSynthesisContext()` (`src/lib/prompts/panel/orchestrator.ts`) is appended to history ahead of the query.

## Executor tool restrictions

`src/lib/tools/panel/restrictedToolset.ts` — `filterExecutorTools()` removes `PANEL_EXECUTOR_EXCLUDED_TOOLS`: `code_execution`, `workspace_edit`, `workspace_create_file`, `ask_user`, `edit_skill`, `deep_research`. Exclusion list (not a whitelist), so executors inherit the full focus-mode set minus the prompting/approval-gated/mutating/recursive tools. Read-only workspace tools (ls/grep/read) intentionally stay — they never interrupt.

## Streaming events

`panel_executor_started` / `_data` / `_completed` / `_error` (payloads + UI handling documented in the `streaming-events` skill). All executors share **one** `<PanelColumns data="base64json">` markup block, mutated via `src/lib/utils/panelMarkup.ts`, rendered by `src/components/MessageActions/PanelColumns.tsx` (columns; tabs on mobile), and stripped from history by `removeToolCallMarkup`.

## UI & persistence

- Composer entry: `src/components/MessageInputActions/PanelSelector.tsx` + device-local `panelSelection`.
- Presets: `src/lib/panel/panelPresets.ts` (stored like model presets) with a Settings section (`src/app/settings/sections/PanelPresetsSection.tsx`).
- `panelPresets` and `panelSelection` are in `MIGRATED_SETTING_KEYS` (DB-synced) — see the `settings-persistence` skill.

## Gotchas

- The separate orchestrator **model** was removed (it duplicated the chat-model picker and silently overrode it). Do not reintroduce one; synthesis always uses `body.chatModel`.
- The final `sources` event re-emits the executor's COMPLETE document set — **replace**, don't append, or you double-count (`sources_added` batches accumulate; `sources` replaces).
- Phase 1 is fired in a non-awaited async IIFE so the HTTP response can subscribe immediately; errors emit a stream `error` event.

Related: `streaming-events`, `subagent-architecture`, `settings-persistence`, `prompt-system`.
