---
name: yaawc-frontend-architecture
description: Use when modifying React components, ChatWindow, MessageBox, MarkdownRenderer, ModelPicker, frontend state, or debugging UI rendering.
---

# Frontend Architecture

Next.js App Router, React 19, Tailwind 4, Headless UI. Styling rules and shared primitives (`Button`, `Card`, `Modal`, `Input`/`Field`, `Select`, `List`, `ApprovalPanel`): see `yaawc-design-system`.

## Component Hierarchy

```
app/layout.tsx
└── Sidebar — icon-rail navigation shell wrapping all pages
    └── Page content
        ├── NewChatWindow (home / new chat — wraps ChatWindow with reset-key logic)
        └── ChatWindow (src/components/ChatWindow.tsx — the orchestrator)
            ├── ChatActions (title, pin, private, export, delete)
            └── Chat (message list, scroll, approval widgets)
                ├── MessageBox[] (user + assistant + compaction rows)
                │   └── MarkdownRenderer → ToolCall / SubagentExecution / PanelColumns /
                │       ArtifactCard / ThinkBox / ChartWidget / CodeBlock
                ├── TodoWidget · CodeExecution · UserQuestionPrompt · WorkspaceEditApproval ·
                │   SkillEditApproval · McpToolApproval (transient, above input)
                └── MessageInput (composer: focus mode, attach, ModelConfigurator,
                    SystemPromptSelector, MethodologySelector, PersonalizationPicker)
```

There is **no Navbar**; `Layout.tsx` is a thin content-width wrapper. Its `<main>` reserves the docked artifact panel's width from the `--artifact-inset` `:root` var, so viewport-fixed chat chrome (ChatActions cluster, composer bar) must shift off the same var. `WorkspaceShell` measures what's left and folds its sidebar to the collapsed rail while a panel is docked (presentation only — stored preference untouched).

## State Management

No global state library. Chat state lives in `ChatWindow.tsx`, the main orchestrator; everything else uses TanStack Query for server state:

- Hooks in `src/lib/hooks/api/` (`useChats`, `useWorkspaces`, `useConfig`, …); never `fetch` directly in components
- `apiFetch`/`ApiError` from `src/lib/api/client.ts`; query keys from `qk` in `src/lib/api/keys.ts`; mutations invalidate their keys

Non-secret settings are DB-backed with a localStorage cache — the sync layer, `MIGRATED_SETTING_KEYS`, and the stale-consumer rules (reactive `useLocalStorage*` hooks vs `subscribeLocalStorage`/`subscribeSettingsSynced`, hydration-gating write-backs) are owned by `yaawc-settings-persistence`. Key frontend rule: anything writing synced keys outside the hooks must use `writeLocalStorage`/`writeLocalStorageBatch` so subscribers are notified.

## Streaming

`ChatWindow.sendMessage()` POSTs to `/api/chat` and reads the NDJSON stream; `attachToRun()` re-attaches to a running run. Every line folds through the one pure reducer via `dispatch(normalizeStreamEvent(line))` — a single dispatch path for live-send and reconnect. Local actions (`stream_started`, `set_messages`, `seed_approvals`) feed the same reducer. `streamStateRef` is the synchronous source of truth; `runEffect` performs the reducer's returned `StreamEffect`s. Event vocabulary, reducer rules, and widget envelopes: see `yaawc-streaming-events`.

## Markdown Rendering

`MarkdownRenderer.tsx` uses `markdown-to-jsx` with overrides:

- **Widget fences** — the `code` override dispatches known `yaawc:<kind>` fences (parsed by `src/lib/widgets/envelope.ts`) to typed components: `ToolCall`, `SubagentExecution`, `PanelColumns`, `ArtifactCard`. Unknown/invalid `yaawc:*` fences fall back to `CodeBlock`.
- **Legacy path (frozen, read-only)** — pre-migration `<ToolCall>`/`<SubagentExecution>`/`<PanelColumns>` tag markup still renders (base64-decoded attrs); nothing writes it anymore.
- **`ArtifactMention`** — a user's `@[Title](artifact:<id>)` is ordinary markdown; the `a` override renders it as a chip (dimmed, inert if deleted). The workspace sidebar reaches the panel/composer via `ArtifactBridgeContext`.
- **`<Chart>`** — model-emitted self-closing tag; renders `ChartWidget` via `useChartSpec()` from `ChartSpecContext`.
- **`<a>`** — citation links (`[N]`) styled via `CitationLink`.
- **Think blocks** — `<think>…</think>` extracted before parsing, rendered as collapsible `ThinkBox` above content.
- **Security** — `iframe`, `script`, `object`, `style` render as `null`.

## Model Selection UI

`ModelPicker` (`src/components/models/`) is the single controlled model-selection component — it owns no persistence; callers pass `value: ModelSelection` and persist `onChange`:

```tsx
<ModelPicker value={selection} onChange={persist}
  fields={{ system?, vision?, contextWindow? }}   // each optional, default off
  presets={'full' | 'apply-save' | 'none'}        // default 'none'
  layout={'inline' | 'dialog'} />
```

Sub-components: `ModelField` (grouped-by-provider popover per role), `VisionToggle`, `ContextWindowField`, `PresetBar`. Embedding models are out of scope (settings keep their own `<Select>`). Chat and system models are independent — no link/mirror; paired combos are Model Presets (`src/lib/models/presets.ts`, stored as JSON under `modelPresets`; no "active preset" pointer — derived by `findMatchingPreset`). `ModelConfigurator` (composer) reads selection keys reactively via `useLocalStorage*` hooks. Selection keys and server-side reading: see `yaawc-settings-persistence`.

## Key Files

| File                                           | Purpose                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/ChatWindow.tsx`                | Orchestrator — state, streaming dispatch, message send                                                                          |
| `src/components/Chat.tsx`                      | Message list + scroll (opening a finished chat anchors at the last answer's first prose block; live runs follow the stream)     |
| `src/components/MessageInput.tsx`              | Composer — text, image paste, attach, `/skill` + `@artifact` autocomplete (`useTokenAutocomplete` + `TokenPopover`)             |
| `src/components/MarkdownRenderer.tsx`          | Markdown→JSX; widget fence + legacy tag dispatch                                                                                |
| `src/components/Artifacts/ArtifactViewer.tsx`  | Artifact iframe, version switcher, Preview/Source, download; shared by `ArtifactPanel` (docked) and `ArtifactPage` (standalone) |
| `src/components/Artifacts/useArtifactPanel.ts` | Panel state + drag-resize width, published as `--artifact-inset`/`--chat-ml` `:root` vars                                       |
| `src/lib/widgets/envelope.ts`                  | Widget envelope codec (see `yaawc-streaming-events`)                                                                            |
| `src/lib/hooks/useLocalStorage.ts`             | `useLocalStorage*` hooks, `writeLocalStorage`/`writeLocalStorageBatch`, `subscribeLocalStorage`                                 |
| `src/lib/models/presets.ts`                    | Preset types + pure helpers + `SELECTION_KEYS`                                                                                  |
| `src/lib/chart/ChartSpecContext.tsx`           | chartId → ChartSpec context                                                                                                     |
