---
name: frontend-architecture
description: Use when modifying React UI components, ChatWindow, MessageBox, MarkdownRenderer, frontend state/streaming event handling, styling, or debugging UI rendering.
---

# Frontend Architecture

The frontend is a Next.js App Router application using React 19, Tailwind CSS 4, and Headless UI.

## Component Hierarchy

```
app/layout.tsx
└── Sidebar (src/components/Sidebar.tsx) — navigation shell wrapping all pages
    └── Page content (via children)
        ├── NewChatWindow (home / workspace /c/new — wraps ChatWindow with reset-key logic)
        └── ChatWindow (active conversation — src/components/ChatWindow.tsx)
            ├── ChatActions (title, pin, private, export, delete)
            └── Chat (src/components/Chat.tsx)
                ├── CompactionIndicator (between compacted message blocks)
                ├── MessageBox[] (one per message, including 'compaction' role rows)
                │   ├── MarkdownRenderer (assistant messages)
                │   │   ├── ToolCall components (inline tool status)
                │   │   ├── SubagentExecution (deep research blocks)
                │   │   ├── ThinkBox (reasoning/thinking blocks)
                │   │   ├── ChartWidget (rendered via <Chart> custom element + ChartSpecContext)
                │   │   └── CodeBlock (syntax-highlighted code)
                │   └── Image gallery (user messages with attachments)
                ├── TodoWidget (above input, research progress)
                ├── CodeExecutionApproval (inline code execution approval widget)
                ├── UserQuestionPrompt (agent pause-for-input widget)
                ├── WorkspaceEditApproval (workspace file edit approval)
                ├── SkillEditApproval (skill file edit approval)
                └── MessageInput (src/components/MessageInput.tsx)
                    ├── Focus mode selector (MessageInputActions/Focus.tsx)
                    ├── Attach button (MessageInputActions/Attach.tsx)
                    ├── ContextIndicator (MessageInputActions/ContextIndicator.tsx)
                    ├── ModelConfigurator (MessageInputActions/ModelConfigurator.tsx)
                    │   └── ModelPicker (components/models/ModelPicker.tsx → PresetBar/ModelField/...)
                    ├── SystemPromptSelector (MessageInputActions/SystemPromptSelector.tsx)
                    ├── MethodologySelector (MessageInputActions/MethodologySelector.tsx)
                    └── PersonalizationPicker (src/components/PersonalizationPicker.tsx)
```

Note: There is **no Navbar component**. The layout is `Sidebar` (icon rail) + `Layout` (content width container). `Layout.tsx` is a thin content-width wrapper, not a full shell. The `theme/` directory contains `Controller.tsx`, `Provider.tsx`, and `Switcher.tsx`.

## State Management

There is **no global state library**. All state lives in `ChatWindow.tsx` (~3400 lines), the main orchestrator component. TanStack Query is used for server state in other components.

### Key state in ChatWindow

| State                       | Type                                            | Purpose                                                    |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `messages`                  | `Message[]`                                     | Full message history (user + assistant + compaction roles) |
| `focusMode`                 | `string`                                        | Current focus mode (`webSearch`, `chat`, `localResearch`)  |
| `loading`                   | `boolean`                                       | Whether a response is in progress                          |
| `pendingImages`             | `ImageAttachment[]`                             | Images attached but not yet sent                           |
| `todoItems`                 | `Array<{content, status}>`                      | Current research task list (transient)                     |
| `liveModelStats`            | `ModelStats \| null`                            | Token counts during streaming                              |
| `gatheringSources`          | `boolean`                                       | Whether sources are still being collected                  |
| `analysisProgress`          | `{message, current, total, subMessage} \| null` | Progress bar for multi-step analysis                       |
| `liveContextGrew`           | `{kind, tokens, totalEstimated, at} \| null`    | Context window growth notification                         |
| `compacting`                | `boolean`                                       | Whether compaction is in progress                          |
| `chartSpecsByMessage`       | `Record<string, Record<string, ChartSpec>>`     | Per-message chart specs (exposed via ChartSpecContext)     |
| `pendingExecutions`         | `Record<string, PendingExecution[]>`            | Code execution approval state                              |
| `pendingQuestions`          | `Record<string, PendingQuestion[]>`             | Agent question prompts pending answer                      |
| `pendingEditApprovals`      | `Record<string, PendingEditApproval[]>`         | Workspace file edit approvals                              |
| `pendingSkillEditApprovals` | `Record<string, PendingSkillEditApproval[]>`    | Skill file edit approvals                                  |
| `isPrivateSession`          | `boolean`                                       | Whether current chat is private (no history saved)         |
| `pinned`                    | `boolean`                                       | Whether chat is pinned in sidebar                          |

Note: `chatHistory` tuples no longer exist as a separate state field. The API receives the full `messages` array.

### TanStack Query (server state)

Components outside ChatWindow use TanStack Query for all server state. Provider is in `src/app/providers.tsx`. Do not `fetch` directly in components.

- Hooks: `src/lib/hooks/api/` (e.g. `useChats`, `useWorkspaces`, `useConfig`, `useActiveRuns`, `useModels`, etc.)
- Client helper: `src/lib/api/client.ts` — exports `apiFetch` and `ApiError`
- Query keys: `src/lib/api/keys.ts` — use `qk.*` constants
- Mutations must invalidate relevant `qk` keys

### Settings persistence (DB-backed, localStorage cache)

Non-secret settings live in the `app_settings` DB table (durable, cross-device);
`localStorage` is a synchronous cache so sync reads keep working with no flash.
`src/lib/settings/persist.ts` patches `Storage.prototype.setItem`/`removeItem`
(installed in `Providers` via `SettingsHydrator`; must patch the **prototype**,
not the instance — instance assignment is silently dropped on the exotic Storage
object) and debounce-PATCHes allowlisted keys (`MIGRATED_SETTING_KEYS` in
`src/lib/settings/keys.ts`) to `/api/settings`. On load it hydrates the cache
from the DB (backfills local→DB on a fresh DB) and re-pulls on tab
focus/visibility and every route navigation (`SettingsHydrator` watches
`usePathname`) via `resyncSettingsFromDb` (throttled, single-flight, skips keys
with unflushed writes, non-blocking), firing `settings-synced`
(`subscribeSettingsSynced`). API access: `src/lib/hooks/api/useSettings.ts`
(`useSettings`/`useUpdateSettings`, key `qk.settings`). **Excluded:** secrets
`openAIApiKey`/`openAIBaseURL` (config.toml) and device-local UI prefs
`appTheme`, `userBg`, `userAccent`, `chatWidthWide`,
`codeExecutionWarningAccepted`.

Writes are intercepted globally, so call sites are unchanged — keep using the
`useLocalStorage*` hooks. A consumer that reads a migrated key once into plain
`useState` (instead of a reactive hook) will go **stale** on the focus re-sync —
it won't see the DB value written into the cache until a remount. Fixes:

- Prefer the reactive `useLocalStorage*` hooks (they react to the
  `local-storage-change` wildcard the re-sync fires). `PreferencesSection` and
  `ImageGenerationSection` use these.
- If the value must stay in `useState` (owned by a parent / threaded through
  props), subscribe to `subscribeLocalStorage(key, cb)` (`useLocalStorage.ts`)
  and re-read — see `MessageInput` (`selectedSystemPromptIds`,
  `selectedMethodologyId`), or reload on `subscribeSettingsSynced` for a bundle
  of keys — see `settings/SettingsPanel.tsx` (`readLocalStorageSettings`).
- A consumer that also writes its state back (`useDashboard`) must additionally
  gate write-backs on `isSettingsHydrated()`/`subscribeSettingsHydrated()`, else
  a stale snapshot clobbers newer DB values; `useDashboard` holds `isLoading`
  until hydrated so its one-shot `refreshAllWidgets` runs against hydrated data.

**Config-API-backed settings** (retention, search providers, private-session
duration — read from `/api/config`, not migrated localStorage keys) don't ride
the localStorage re-sync. `useConfig` sets `refetchOnWindowFocus: true` so they
refetch on focus, and `settings/SettingsPanel.tsx` mirrors the response continuously
(`applyConfigObject` keyed on `configData`) rather than once, so cross-device
edits land without a reload.

### Model preferences (localStorage cache)

Model selections are read synchronously from the `localStorage` cache (DB-backed
per above), not React state:

- `chatModel`, `chatModelProvider` — Chat model selection
- `systemModel`, `systemModelProvider` — System model selection (independent of chat)
- `embeddingModel`, `embeddingModelProvider` — Embedding model
- `imageCapable` — When `"true"`, allow image attachments for the chat model
- `contextWindowSize` — Available context window (int string; default `32768`)

`ModelConfigurator` reads these selection keys **reactively** via the
`useLocalStorageString`/`useLocalStorageBoolean` hooks (no longer a one-shot
mount effect), so changes made anywhere — including applying a preset — reflect
immediately. Anything writing these keys outside the hooks must go through
`writeLocalStorage` / `writeLocalStorageBatch` so subscribers are notified. Chat
and system models are selected independently — there is no link/mirror toggle;
paired combos are saved as Model Presets. When `systemModel` is empty, chat
requests fall back to the chat model server-side.

### Unified `ModelPicker` (`src/components/models/`)

`ModelPicker` is the **single controlled** model-selection component used
everywhere models are picked. It owns **no persistence** — caller passes
`value: ModelSelection` and persists `onChange` itself.

```tsx
<ModelPicker value={selection} onChange={persist}
  fields={{ system?, vision?, contextWindow? }}   // each optional, default off
  presets={'full' | 'apply-save' | 'none'}        // default 'none'
  layout={'inline' | 'dialog'} />                 // panel opens below | above
```

It emits a complete `ModelSelection` on every change; chat and system models are
selected independently (no link/mirror — paired combos live in Model Presets).
Sub-components in the same dir: `ModelField` (grouped-by-provider popover for one
role — replaces the old `ModelSelector`), `VisionToggle`, `ContextWindowField`,
`PresetBar` (controlled preset switch + "Save current…"), `PresetOption`.
Embedding models are **out of scope** for `ModelPicker` (settings + scheduled
tasks keep their own embedding `<Select>` / `EmbeddingModelSelector`).

Callers: chat `ModelConfigurator` (`fields={system,vision,contextWindow}`,
`presets=full`, `layout=dialog`); `ModelPresetsSection` per-preset editor
(`fields` all, `presets=none`); `ScheduledTaskForm` (`fields={system}`,
`presets=apply-save`); `DefaultSearchSection` + dashboard `WidgetConfigModal`
(chat-only, `presets=none`). `ModelSettingsSection` uses `ModelField` directly
for its minimal **system** picker.

### Model presets (localStorage `modelPresets`)

Named bundles of chat+system provider/model, vision, and context window, stored
as JSON under `modelPresets`. Pure helpers live in `src/lib/models/presets.ts`
(`loadPresets`, `savePresets`, `createPreset`, `findMatchingPreset`,
`applyPresetToStorage`, `captureCurrentSelection`, `isPresetAvailable`,
`presetSummary`, plus the unified-picker helpers `presetToSelection`,
`selectionToPresetInput`, `selectionToActiveSelection`, `writeSelectionToStorage`,
and `SELECTION_KEYS` / `PRESETS_KEY` / `PREDEFINED_CONTEXT_SIZES` /
`DEFAULT_CONTEXT_WINDOW` constants). There is **no stored "active preset"
pointer** — the active preset is derived by matching the current selection via
`findMatchingPreset`.

Surfaces:

- **`PresetBar`** (inside `ModelPicker`) — quick switch + "Save current…".
  Apply emits a `ModelSelection` via `presetToSelection` so non-localStorage
  callers work; save reads the current `value`. `mode=full` shows a "Manage"
  link to settings; `mode=apply-save` omits it.
- **`ModelPresetsSection`** (Settings → Model Presets) — full CRUD + up/down
  reorder; each editor body is a `ModelPicker`.

Personalization is stored in `localStorage` and accessed via `useLocalStorageBoolean`/`useLocalStorageString` hooks from `src/lib/hooks/useLocalStorage.ts`:

- `personalization.sendLocationEnabled` — send user location with requests
- `personalization.sendProfileEnabled` — send user profile with requests
- `personalization.location`, `personalization.about` — the actual values

## Streaming Event Handling

`ChatWindow.sendMessage()` POSTs to `/api/chat` and reads the response as a stream. `attachToRun()` re-attaches to an already-running run (e.g. after page reload on a backgrounded chat).

The `messageHandler()` function dispatches by event `type`:

| Event Type                                          | Handler Action                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `response`                                          | Buffer tokens; append to assistant message content (bufferThreshold-based)  |
| `sources` / `sources_added`                         | Set/append to message sources array                                         |
| `tool_call_started`                                 | Append `<ToolCall>` markup to message content                               |
| `tool_call_success` / `tool_call_error`             | Regex-rewrite existing `<ToolCall>` tag attributes                          |
| `subagent_started`                                  | Append `<SubagentExecution>` markup                                         |
| `subagent_data`                                     | Forward nested tool/response events to subagent context                     |
| `subagent_completed` / `subagent_error`             | Update SubagentExecution markup with final status                           |
| `todo_update`                                       | Update `todoItems` state (renders in TodoWidget)                            |
| `stats`                                             | Update `liveModelStats` for token display                                   |
| `progress`                                          | Update `analysisProgress` (multi-step analysis progress bar)                |
| `context_grew`                                      | Update `liveContextGrew` (context window growth notification)               |
| `chart_spec`                                        | Store ChartSpec in `chartSpecsByMessage` (exposed via ChartSpecContext)     |
| `code_execution_pending`                            | Add to `pendingExecutions` for CodeExecutionApproval widget                 |
| `code_execution_answered` / `code_execution_result` | Update/resolve code execution                                               |
| `user_question_pending` / `user_question_answered`  | Add/resolve agent question prompt                                           |
| `workspace_edit_approval_pending` (and variants)    | Add/resolve workspace file edit approval                                    |
| `skill_edit_approval_pending` (and variants)        | Add/resolve skill file edit approval                                        |
| `messageEnd`                                        | Finalize assistant message, trigger auto-suggestions, clear transient state |
| `ping`                                              | No-op keep-alive                                                            |

## Markdown Rendering

`MarkdownRenderer.tsx` uses `markdown-to-jsx` with custom component overrides:

### Custom elements

- **`<ToolCall>`**: Renders tool execution status widgets (spinner/check/X) with tool-specific icons. Attributes: `type`, `status`, `toolCallId`, `query`, `url`, `error`, etc.
- **`<SubagentExecution>`**: Collapsible deep research panel. Attributes: `name`, `task`, `status`, `response`, `error`.
- **`<Chart>`**: Renders a `ChartWidget`. Looks up the `ChartSpec` via `useChartSpec()` from `ChartSpecContext`. Attribute: `id`.
- **`<a>` links**: Citation links (`[N]`) get special styling via `CitationLink` component.
- **Security blocks**: `iframe`, `script`, `object`, `style` tags render as `null`.

### Think block handling

Before markdown parsing, the renderer extracts `<think>...</think>` blocks (and orphaned `</think>` tags) from LLM output. These render as collapsible `ThinkBox` components above the main content.

## Styling Conventions

### Theme system

- CSS custom properties in `globals.css` define theme tokens
- `theme/Controller.tsx` wraps the app with theme context
- `theme/Provider.tsx` provides theme context
- `theme/Switcher.tsx` provides the dark/light toggle

### Key Tailwind patterns

```
bg-bg           — page/root background
bg-surface      — primary surface background
bg-surface-2    — secondary/card background
text-fg         — primary text
text-fg/70      — muted text (70% opacity)
text-accent     — accent color (links, active items)
border-surface-2 — borders
```

- Use `cn()` utility (from `src/lib/utils.ts`, wraps `clsx` + `tailwind-merge`) for conditional class merging
- Headless UI (`@headlessui/react`) for dropdowns, selects, dialogs
- Lucide React for icons
- `prose prose-theme dark:prose-invert` for markdown content typography

### Component file conventions

- One component per file in `src/components/`
- Sub-components grouped in directories (`MessageActions/`, `MessageInputActions/`, `Chats/`, `Workspaces/`, `dashboard/`, `common/`, `theme/`, `ui/`)
- Functional components with TypeScript interfaces for props
- No CSS modules — all Tailwind utility classes

## Key Files Reference

| File                                                         | Purpose                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/components/ChatWindow.tsx`                              | Main orchestrator — state, streaming, message send (~3400 lines)         |
| `src/components/NewChatWindow.tsx`                           | Wrapper that resets ChatWindow key on return to root path                |
| `src/components/Chat.tsx`                                    | Message list rendering, scroll management, approval widgets              |
| `src/components/ChatActions.tsx`                             | Per-chat header actions (pin, private, export, delete)                   |
| `src/components/MessageBox.tsx`                              | Individual message display (user + assistant + compaction)               |
| `src/components/MessageInput.tsx`                            | Text input, image paste, file attach, skill autocomplete                 |
| `src/components/MarkdownRenderer.tsx`                        | Markdown→JSX with ToolCall/SubagentExecution/Chart                       |
| `src/components/EmptyChat.tsx`                               | Initial empty state with focus mode                                      |
| `src/components/TodoWidget.tsx`                              | Research progress bar (transient)                                        |
| `src/components/ThinkBox.tsx`                                | Collapsible reasoning/thinking block                                     |
| `src/components/ChartWidget.tsx`                             | Chart rendering (uses ChartSpec from ChartSpecContext)                   |
| `src/components/CompactionIndicator.tsx`                     | Visual marker between compacted message blocks                           |
| `src/components/Sidebar.tsx`                                 | Icon-rail navigation (uses TanStack Query for active runs/badges)        |
| `src/components/Layout.tsx`                                  | Content width container (not a full shell)                               |
| `src/components/CodeExecution.tsx`                           | Code execution approval widget types and UI                              |
| `src/components/UserQuestionPrompt.tsx`                      | Agent pause-for-input question widget                                    |
| `src/components/WorkspaceEditApproval.tsx`                   | Workspace file edit approval widget                                      |
| `src/components/SkillEditApproval.tsx`                       | Skill file edit approval widget                                          |
| `src/components/MessageInputActions/Focus.tsx`               | Focus mode selector buttons                                              |
| `src/components/MessageInputActions/ModelConfigurator.tsx`   | Chat model trigger + dialog; wraps `ModelPicker` (reactive localStorage) |
| `src/components/models/ModelPicker.tsx`                      | Unified controlled model picker (used everywhere)                        |
| `src/components/models/` (ModelField, PresetBar, ...)        | Picker sub-components (field popover, preset bar, toggles, ctx window)   |
| `src/components/MessageInputActions/MethodologySelector.tsx` | Methodology (deep research style) selector                               |
| `src/components/MessageActions/SubagentExecution.tsx`        | Deep research UI panel                                                   |
| `src/components/MessageActions/ModelInfo.tsx`                | Per-response model stats display                                         |
| `src/lib/hooks/api/`                                         | TanStack Query hooks for all server state                                |
| `src/lib/api/client.ts`                                      | `apiFetch` / `ApiError` shared fetch helper                              |
| `src/lib/api/keys.ts`                                        | `qk` query key constants                                                 |
| `src/lib/chart/ChartSpecContext.tsx`                         | React context for chart specs (chartId → ChartSpec)                      |
| `src/lib/hooks/useLocalStorage.ts`                           | `useLocalStorage*` hooks, `writeLocalStorage`/`writeLocalStorageBatch`   |
| `src/lib/models/presets.ts`                                  | Model preset types + pure helpers + selection key constants              |
| `src/app/settings/sections/ModelPresetsSection.tsx`          | Settings model preset CRUD + reorder                                     |
