---
name: yaawc-agent-panel
description: 'Agent Panel parallel executor/synthesis mode: configuration, tool restrictions, events, persistence, and composer UI.'
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
   - Toolset is the focus-mode toolset minus the prompting/mutating/recursive set (`filterExecutorTools`, see below). Mapping tools are never added to the panel executor or synthesis path.
   - After all settle (`Promise.allSettled`; `runOne` never throws), sources are merged + deduped into one ordered citation set with 1-based `sourceId`s. Dedup key: real `url`, else a meaningful `source` (NOT the `file_search` sentinel), else `title::pageContent`. If zero executors succeed, it throws.
   - Token usage: the coordinator receives the turn's shared `TokenTracker` and, per executor N, registers a chat-role recorder (executor's own model) and a system-role recorder (shared system model) under `scope: 'panel_executor:N'`; those recorders feed the child `SimplifiedAgent`. `panel_executor_completed.usage` is `tracker.scopeUsage('panel_executor:N')` (the frozen `PanelUsage` shape). See `src/lib/tokens/tracker.ts`.

2. **Phase 2 — synthesis**: the chat model runs as an **ordinary agent** (full tools, interrupts/resume unchanged) via `handler.searchAndAnswer(..., workspaceTools, mergedSources)`. The merged citation set is passed as `initialDocuments`; a synthesis `SystemMessage` from `buildOrchestratorSynthesisContext()` (`src/lib/prompts/panel/orchestrator.ts`) is appended to history ahead of the query. Synthesis runs on the turn's root chat recorder, so a model reused as both executor and synthesizer collapses into one `ModelStatsV2.perModel` row.

## Executor tool restrictions

`src/lib/tools/panel/restrictedToolset.ts` — `filterExecutorTools()` removes mapping tools as well as `PANEL_EXECUTOR_EXCLUDED_TOOLS`: mapping requires an ordinary interactive Web Search turn and panel executors/synthesis are excluded. The remaining exclusion list removes: `code_execution`, `workspace_edit`, `workspace_create_file`, `ask_user`, `edit_skill`, `deep_research`, and the three artifact tools (`create_artifact`, `edit_artifact`, `read_artifact` — chat-scoped rows an executor has no chat to own; authoring belongs to the synthesizing model). The invariant `search_yaawc_docs` system tool is not excluded, so both executors and the ordinary synthesis pass can ground YAAWC claims. Exclusion list (not a whitelist), so executors inherit the full focus-mode set minus the prompting/approval-gated/mutating/recursive tools. Read-only workspace tools (ls/grep/read) intentionally stay — they never interrupt.

## Streaming events

`panel_executor_started` / `_data` / `_completed` / `_error` (payloads + UI handling documented in the `yaawc-streaming-events` skill). All executors share **one** `yaawc:panel` fenced-JSON widget (`{ id, columns: [{ idx, model, status, responseText?, sourceCount?, tokens?, error? }] }`), patched via `startPanelColumn`/`appendPanelColumnToken`/`setPanelColumnStatus` in `src/lib/widgets/envelope.ts`, rendered by `src/components/MessageActions/PanelColumns.tsx` (columns; tabs on mobile), and stripped from history by `removeToolCallMarkup`. Executor chart registrations are forwarded as `chart_spec` milestones with namespaced private ids; `panel_executor_chart` appends a writer-owned `yaawc:chart` envelope inside the originating column. Each executor keeps its own turn-local handle namespace, so overlapping `chart_1` handles cannot collide. Panel executors do not use raw chart tags. Pre-migration messages render the old `<PanelColumns data="base64json">` tag via a frozen legacy path (`decodeLegacyPanelData` next to the renderer).

## UI & persistence

- Composer entry: `src/components/MessageInputActions/PanelSelector.tsx` + device-local `panelSelection`. Split control: the icon half toggles the panel in one click, the chevron half opens configuration. Below `sm` the split collapses to the chevron alone (single Layers button) and the popover header carries an on/off switch — one trigger on every viewport, which headlessui requires (the panel anchors to the last-mounted `PopoverButton`). `enabled` can only be set while the selection holds 2–4 executors (`hasValidExecutors`), so the engaged state always matches what the turn sends — clicking the toggle on an under-configured panel opens the popover instead. Removing executors below the minimum clears `enabled`. Applying a preset is the one action that enables implicitly.
- Presets: `src/lib/panel/panelPresets.ts` (stored like model presets) with a Settings section (`src/app/settings/sections/PanelPresetsSection.tsx`).
- `panelPresets` and `panelSelection` are in `MIGRATED_SETTING_KEYS` (DB-synced) — see the `yaawc-settings-persistence` skill. Mapping settings do not change this exclusion: panel runs never receive mapping tools.

## Gotchas

- Chart lifecycle tools are available to the synthesizing top-level Chat/Web/Local agent, but remain excluded from deep-research subagents and panel executor restrictions unless the executor focus toolset explicitly includes them; executor placement is always bridged structurally into its column.
- The separate orchestrator **model** was removed (it duplicated the chat-model picker and silently overrode it). Do not reintroduce one; synthesis always uses `body.chatModel`.
- The final `sources` event re-emits the executor's COMPLETE document set — **replace**, don't append, or you double-count (`sources_added` batches accumulate; `sources` replaces). Capability-document sections are internal sources and keep their exact `/docs/capabilities/...#...` URLs through this merge.
- Phase 1 is fired in a non-awaited async IIFE so the HTTP response can subscribe immediately; errors emit a stream `error` event. Deep-research subagents still receive their unchanged static whitelist and do not receive `search_yaawc_docs`.

Related: `yaawc-streaming-events`, `yaawc-deep-research-subagents`, `yaawc-settings-persistence`, `yaawc-prompt-system`.
