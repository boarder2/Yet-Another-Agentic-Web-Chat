---
name: streaming-events
description: Use when working on tool-call lifecycle events, todo updates, subagent streaming, the stream-event vocabulary/reducer (src/lib/streaming/), SimplifiedAgent/runHost/ChatWindow event handling, MarkdownRenderer ToolCall, TodoWidget, or debugging missing or broken streaming output.
---

# Streaming Events System

The `SimplifiedAgent` emits granular lifecycle events for tool execution, todo updates, subagent activity, and interrupt/approval flows so the UI can reflect real-time status. Milestone events (see below) are persisted to the `run_events` table (`runEventsPersistence.ts`) so paused (backgrounded) chats can be fully reconstructed on resume.

## The `src/lib/streaming/` seam

One module owns the whole vocabulary and the single agent→UI channel:

- **`events.ts`** — two discriminated unions plus the transport. `AgentEmitEvent` is what producers emit; `StreamEvent` is the NDJSON wire form the client reads. Producers call `emitStreamEvent(emitter, event)` / consumers `onStreamEvent(emitter, handler)` on ONE channel (`STREAM_EVENT_CHANNEL = 'stream_event'`) — no more per-type channels. `isAgentControlEvent` separates control events (`model_stats`, `interrupt`, `agent_end`, `agent_error`, `tool_llm_usage`) from wire-bound ones. `parseStreamEvent` (wire line → typed) and `normalizeStreamEvent` (legacy type aliases → canonical, e.g. `user_question_pending` → `ask_user_pending`) bridge the client.
- **`reducer.ts`** — `reduceStreamEvent(state, event) → { state, effects }`, one pure transition per event, shared by the live-send and reconnect/attach paths. Mode differences fold into rules: bucket key is `event.messageId ?? activeAiMessageId` (live events carry the assistant id, which the reducer adopts so id-less `*_answered`/`*_stale`/`*_cancelled` bucket right); replay-gating is the `inReplay` state field (attach only, until `replay_complete`); idempotency guards and the rich `messageEnd` finalization apply in both modes.
- **`effects.ts`** — `StreamEffect`, the data the reducer returns for side effects (`toastError`, `setLoading`, `bumpScroll`, `invalidateActiveRuns`, `invalidateWorkspace`, `fetchSuggestions`, `refreshSkills`). `ChatWindow` interprets them; the reducer never performs them.

`reducer.ts` and `events.ts` are pure — unit-tested (`*.test.ts`, `npm run test:unit`), the narrow exception to the e2e-only policy.

## Tool Call Lifecycle Events

| Event Type          | When Emitted                                                     | Payload                                                                                                                      | UI Behavior                                                                                                    |
| ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `tool_call_started` | Immediately when a tool run begins (LangChain `handleToolStart`) | `{ data: { content: "<ToolCall … status=\"running\" toolCallId=\"RUN_ID\" …></ToolCall>", toolCallId, status: "running" } }` | Appends a ToolCall widget with spinner                                                                         |
| `tool_call_success` | On successful completion (`handleToolEnd`)                       | `{ data: { toolCallId, status: "success", extra?: { [k: string]: string } } }`                                               | Replaces the widget status icon with green check; merges any `extra` attributes into existing `<ToolCall>` tag |
| `tool_call_error`   | On exception (`handleToolError`)                                 | `{ data: { toolCallId, status: "error", error: "message" } }`                                                                | Replaces spinner with red X and shows error text                                                               |

**Skipped tools** — `deep_research`, `todo_list`, and `create_chart` never emit generic lifecycle events; they have specialized inline rendering. System-source `read_skill` invocations are also silently suppressed.

**Interrupt handling** — LangGraph interrupts propagate as errors through `handleToolError`. They are detected via `isGraphInterrupt(err)` and silently dropped (no `tool_call_error` emitted); the widget stays "running". After the stream loop ends, the agent calls `agent.getState()` to collect pending interrupts and emits an `interrupt` control event. `runHost` handles it (via `onStreamEvent` + `isAgentControlEvent`) to persist approvals and transition the run to `awaiting_user` status.

**Resume path** — `doResume()` reconstructs a fresh agent from the LangGraph checkpoint and streams a `Command({ resume: resumeArg })`. Re-invoked interrupted tools (already have markup widgets from the original run) are identified by stable LLM `tool_call_id` and suppressed in `handleToolStart` to avoid duplicate chips. New tools spawned post-resume emit the full lifecycle normally.

## Todo List Events

The `todo_list` tool emits `todo_update` events for research progress tracking. Unlike other tools, `todo_list` skips generic `tool_call_started/success/error` events and uses its own rendering via the `TodoWidget` component.

| Event Type    | When Emitted                          | Payload                                      | UI Behavior                                                          |
| ------------- | ------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `todo_update` | Each time the agent calls `todo_list` | `{ data: { todos: [{ content, status }] } }` | Updates the TodoWidget above the message input with current progress |

- The TodoWidget (`src/components/TodoWidget.tsx`) is a collapsible bar above the message input
- Collapsed: shows "Tasks: X/Y complete - [current task]"
- Expanded: shows all items with status icons (pending/in_progress/completed)
- Transient: the widget clears when the response completes (not persisted in message content)
- Only used for thorough/complex research, not simple queries

## Subagent Events

Emitted by `SubagentExecutor` (`src/lib/search/subagents/executor.ts`):

| Event Type           | Payload                                                                 | UI Behavior                                                   |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `subagent_started`   | `{ executionId, name, task, status: "running" }`                        | Appends `<SubagentExecution …>` markup to in-progress message |
| `subagent_data`      | `{ executionId, data }` — streaming tokens from the subagent's response | Nested inside the `SubagentExecution` widget display          |
| `subagent_completed` | `{ executionId, … }`                                                    | Updates widget `status` to `"success"`                        |
| `subagent_error`     | `{ executionId, … }`                                                    | Updates widget `status` to `"error"`                          |

## Agent Panel Events

Emitted by `PanelCoordinator` (`src/lib/search/panel/coordinator.ts`) during Phase 1 fan-out. All executors share ONE `<PanelColumns data="base64json">` block (mutated via `src/lib/utils/panelMarkup.ts`), rendered by `PanelColumns.tsx`.

| Event Type                 | Payload                                             | UI Behavior                                           |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `panel_executor_started`   | `{ executorIdx, model }`                            | Adds an executor column (status running). Idempotent. |
| `panel_executor_data`      | `{ executorIdx, token }` — streamed response tokens | Accumulates into that column's `responseText`         |
| `panel_executor_completed` | `{ executorIdx, model, sourceCount, usage }`        | Column → success; shows source + token counts         |
| `panel_executor_error`     | `{ executorIdx, model, error }`                     | Column → error                                        |

`_started/_completed/_error` are persisted milestones; `_data` is not (the accumulated `responseText` lives in the persisted message content, like `subagent_data`). The chat model's synthesized final answer streams via the normal `response` path below the columns.

## Approval / Interrupt Events (Persistent Sessions)

These events are emitted by tools that interrupt the LangGraph run for user approval. All `*_pending` events are persisted as milestones so they can be replayed on resume. The frontend also handles an `*_answered` companion event to update UI state.

| Event Type Family                                                                                             | Tool Origin                                      | UI Element                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------- |
| `code_execution_pending` / `code_execution_answered` / `code_execution_result`                                | `code_execution` tool                            | Code approval / result chip |
| `user_question_pending` / `ask_user_pending` / `user_question_answered` / `ask_user_answered`                 | `ask_user` tool                                  | Question widget             |
| `workspace_edit_approval_pending` / `workspace_edit_pending` / `workspace_create_pending` + `*_answered`      | `workspace_edit` / `workspace_create_file` tools | File diff approval card     |
| `skill_edit_approval_pending` / `skill_edit_pending` + `skill_edit_approval_answered` / `skill_edit_answered` | `edit_skill` tool                                | Skill diff approval card    |
| `mcp_tool_pending` / `mcp_tool_answered`                                                                      | MCP tools (`mcp__*` namespaced)                  | `McpToolApproval` card      |

`runHost.ts` emits `*_pending` events on first observation (using the `` `${kind}_pending` `` template). The reducer deduplicates these against the `/api/approvals/pending` fetch path (the mount-time rebuild dispatches a `seed_approvals` local action) using `approvalId`. The wire uses canonical `kind` names (`ask_user`, `workspace_edit`, `skill_edit`, …); `normalizeStreamEvent` maps any legacy aliases replayed from persisted buffers before the reducer sees them.

## Other Milestone Events

| Event Type               | Emitted By                                                  | UI Behavior                                                                                             |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sources_added`          | `SimplifiedAgent` (during stream)                           | Populates in-progress sources panel grouped by `searchQuery`                                            |
| `sources`                | `SimplifiedAgent` (on completion)                           | Sets final sources on the finished assistant message                                                    |
| `chart_spec`             | `createChartTool` / `codeExecutionTool`                     | Renders a chart widget keyed by `chartId` in the message                                                |
| `workspace_file_changed` | `workspace_edit` / `workspace_create_file` tools            | Invalidates TanStack Query for the affected workspace                                                   |
| `replay_complete`        | `runHost.ts` (after replaying persisted events)             | Sentinel that flips the reducer's `inReplay` off (and corrects seed content) so live tokens append      |
| `stats`                  | `runHost` (translated from the `model_stats` control event) | Updates live token usage display                                                                        |
| `context_grew`           | `runHost.ts`                                                | Shows context-grew indicator                                                                            |
| `response`               | `SimplifiedAgent.emitResponse()`                            | Streams assistant text tokens to the in-progress message                                                |
| `widget_proposal`        | `propose_widget_changes` (widget-builder tools)             | `WidgetChatPanel` renders a `WidgetProposalCard` (delta + Accept/Reject); carries a base-revision stamp |

## Widget-builder stream (dashboard code widgets)

The code-widget editor's assistant runs a dedicated, **non-persisted** SSE route
`POST /api/dashboard/widget-builder` (not `/api/chat` — no checkpointer/history/
memory). It constructs a `SimplifiedAgent` with `focusMode: 'chat'`, a custom
system prompt (current widget state + latest error injected per turn), and a
**server-enforced tool allowlist** of exactly four custom tools from
`src/lib/tools/agents/widgetBuilderTools.ts`: `read_current_widget`,
`sample_source`, `preview_widget_output` (sandboxed, rate-limited ≤5/turn), and
`propose_widget_changes` (emits `widget_proposal`). The agent never edits the
widget directly — the user Accepts a proposal. The route pipes the agent's
`EventEmitter` straight to an SSE `ReadableStream`; `WidgetChatPanel` tolerates
the full event vocabulary and renders only `response` (markdown) + proposals.

## Implementation Details

### Backend (Event Emission)

- Emission logic lives in `src/lib/search/simplifiedAgent.ts`. Callbacks (`handleToolStart`, `handleToolEnd`, `handleToolError`) are registered on each `agent.streamEvents()` call — once in `searchAndAnswer()` and once in `doResume()`. Both paths `emitStreamEvent` identical `AgentEmitEvent` shapes on the single channel.
- `model_stats` is a control event; `runHost` translates it to the `stats` wire event. `interrupt`/`agent_end`/`agent_error`/`tool_llm_usage` are control events too (see `isAgentControlEvent`) — never forwarded verbatim to the wire.
- `runHost` is the synthesis point: it stamps the assistant `messageId`, accumulates markup, and adds events with no producer (`messageEnd`, `replay_complete`, `gone`, `*_pending`/`*_answered`). Milestone events are buffered and persisted via `src/lib/runs/runEventsPersistence.ts` for run reconstruction after server restart or eviction.

### Frontend (Event Handling)

`ChatWindow.tsx` reads the NDJSON stream and folds every line through the reducer: `dispatch(normalizeStreamEvent(line))`. There is **one** dispatch path for both live-send and reconnect/attach — no separate handlers. Non-wire **local actions** feed the same reducer/dispatch: `stream_started` (turn/attach setup), `set_messages` (non-stream message writes — load, rewrite, delete, suggestions), and `seed_approvals` (the mount-time `/api/approvals/pending` rebuild). `streamStateRef` is the synchronous source of truth (the async stream loop reads it between dispatches); `streamState` mirrors it for rendering, and a render-key gate skips the re-render when only internal accumulators change (response-token buffering). Effects the reducer returns are run by `runEffect`. Notable rules the reducer encodes:

- `tool_call_started`: appends the received `<ToolCall …>` markup to the assistant row, deduped by `toolCallId` (idempotent for replay).
- `tool_call_success` / `tool_call_error`: `updateToolCallMarkup()` rewrites the existing tag — `status`, `error`, and any `extra` key/values as attributes.
- `replay_complete`: flips `inReplay` off (attach path) so subsequent `response` tokens append instead of being filtered — the resume path first replays persisted milestones and pre-seeds content from the DB, so tokens must be gated during replay to avoid duplication.

### Markdown Rendering

The `ToolCall` component (`src/components/MarkdownRenderer.tsx`) accepts many attributes:

- Core: `type`, `status` (`running` | `success` | `error`), `toolCallId`, `query`, `url`, `count`, `videoId`, `imageId`, `error`
- Code execution: `code` (base64), `description`, `exitCode`, `stdout`, `stderr`, `timedOut`, `oomKilled`, `denied`
- Ask user: `selectedOptions`, `freeformText`, `skipped`

Renders:

- `running`: inline spinner
- `success`: green check
- `error`: red X + error message (truncated, sanitized)

## Markup Mutation

A shared helper (`updateToolCallMarkup` in `src/lib/utils/toolCallMarkup.ts`) is used by both the reducer (`src/lib/streaming/reducer.ts`) and the backend to guarantee identical attribute mutation logic. `code`, `stdout`, and `stderr` attributes are base64-encoded (not HTML-entity escaped) to avoid breaking the markdown parser.

## Notes & Constraints

- Tool attributes (`query`, `count`, `url`) are lightly extracted on start and truncated to `TOOL_ARG_MAX_LENGTH = 350` to avoid large payloads.
- `toolCallId` is the LangChain callback `runId`, ensuring uniqueness across concurrent tool executions.
- For persistence, the start markup is appended to the stored assistant message content; on `tool_call_success` / `tool_call_error` the backend rewrites the original `<ToolCall …>` tag with the final `status` (and `error` attribute if present).
- A synthetic Firefox AI detection event is a single `tool_call_started` with `status="success"` and `type="firefoxAI"` (no actual external tool execution). Emitted before the first LangGraph event in `searchAndAnswer()`.
- `run-ID attribution` sets (`deepResearchRunIds`, `parentToolsNodeRunIds`, `activeAgentLlmRunIds`) guard against child `SimplifiedAgent` events (from `deep_research` subagents) leaking into the parent's tool-call and token streams, since LangChain's `AsyncLocalStorage` propagates parent callbacks into nested tool executions.
