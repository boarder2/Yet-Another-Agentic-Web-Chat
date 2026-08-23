---
name: yaawc-streaming-events
description: 'Agent-to-UI stream contract: NDJSON events, runHost, reducer/effects, replay, widget envelopes, and approvals.'
---

# Streaming Events

One seam between agent and UI. Milestone events persist to `run_events` (`runEventsPersistence.ts`) so backgrounded chats reconstruct on resume.

## The `src/lib/streaming/` seam

- **`events.ts`** — `AgentEmitEvent` (producer side) and `StreamEvent` (NDJSON wire form), both structured data only, on ONE channel (`emitStreamEvent`/`onStreamEvent`, `STREAM_EVENT_CHANNEL`). `isAgentControlEvent` separates control events (`model_stats`, `interrupt`, `agent_end`, `agent_error` — never forwarded verbatim to the wire) from wire-bound ones. `parseStreamEvent` decodes wire lines; `normalizeStreamEvent` maps legacy aliases to canonical kinds (`user_question_pending` → `ask_user_pending`).
- **`reducer.ts`** — `reduceStreamEvent(state, event) → { state, effects }`, one pure transition per event, shared by live-send and reconnect/attach. Bucket key is `event.messageId ?? activeAiMessageId`; replay-gating is the `inReplay` state field (attach only, until `replay_complete`); idempotency guards apply in both modes.
- **`effects.ts`** — `StreamEffect` values the reducer returns (`toastError`, `setLoading`, `bumpScroll`, `invalidateActiveRuns`, `invalidateWorkspace`, `fetchSuggestions`, `refreshSkills`, `setChatTitle`, `openArtifact`, `invalidateArtifacts`); `ChatWindow.runEffect` performs them, the reducer never does.

`reducer.ts`/`events.ts` are pure — unit-tested directly; keep this behavior at the fast unit-test layer rather than duplicating it in e2e.

**Producers**: `simplifiedAgent.ts` registers `handleToolStart/End/Error` on each `agent.streamEvents()` call — in `searchAndAnswer()` AND `doResume()`, identical shapes. **`runHost.ts` is the synthesis point**: stamps the assistant `messageId`, serializes widget events into persisted content via the codec, adds producer-less events (`messageEnd`, `replay_complete`, `gone`, `*_pending`/`*_answered`), translates `model_stats` → `stats`, buffers milestones for persistence. `chatTitle` (auto-title, first turn) is pushed after `messageEnd`, before `terminate` — the only window still reaching subscribers; generation lives in `attachRunHost`'s `agent_end` branch (`src/lib/utils/chatTitle.ts`).

**Consumer**: `ChatWindow` folds every NDJSON line through `dispatch(normalizeStreamEvent(line))` — one path for live and attach. Local actions (`stream_started`, `set_messages`, `seed_approvals`) feed the same reducer. `streamStateRef` is the synchronous source of truth; a render-key gate skips re-renders when only internal accumulators change.

## Widget envelopes (`src/lib/widgets/envelope.ts`)

Events carry structured payloads — never markup. The two writers (`reducer.ts` client-side, `runHost.ts` server-side) serialize them into the assistant message with one isomorphic codec:

- A widget is a code fence with a reserved `yaawc:<kind>` info string + compact single-line JSON. Kinds: `tool_call`, `subagent`, `panel`, `artifact`, and writer-owned `chart` placements.
- `appendWidget`/`updateWidget`/`findWidget` (idempotent on payload `id`); `appendChartWidget` (unique placement id plus private canonical chart id); `upsertArtifactWidget` (one card per artifact per message); `parseWidgetFence` (render-side decode); `stripWidgets` (LLM context/clipboard); `neutralizeSpoofedFences` downgrades any model-streamed `yaawc:` fence — all legitimate envelopes are writer-appended, so forging is structurally impossible. A chart envelope never exposes the model handle or accepts a raw chart tag.
- `MarkdownRenderer`'s `code` override dispatches known kinds to `ToolCall`/`SubagentExecution`/`PanelColumns`/`ArtifactCard`/`ChartEnvelope`; unknown/invalid falls back to a plain code block. Pre-migration `<ToolCall>`-style tag markup renders via a frozen, read-only legacy path. Historical chat `<Chart>` tags and dashboard-generated placeholders remain on that legacy path; new streamed chat tags are stripped and new placement is `show_chart`.
- Codec unit-tested (`envelope.test.ts`), including markdown-to-jsx parse-shape tests (regression net for the nested-widget-spillage bug this format fixed).

## Tool-call lifecycle

| Event               | Payload                                                        | UI                                               |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `tool_call_started` | `{ data: { toolCallId, toolType, status:"running", attrs? } }` | Appends `yaawc:tool_call` widget (deduped by id) |
| `tool_call_success` | `{ data: { toolCallId, status:"success", extra? } }`           | Patches widget; `extra` merged into payload      |
| `tool_call_error`   | `{ data: { toolCallId, status:"error", error } }`              | Patches widget with error                        |

- `toolCallId` is the LangChain callback `runId`; attrs are extracted on start, truncated to `TOOL_ARG_MAX_LENGTH = 350`.
- **Skipped**: `deep_research`, `todo_list`, `create_chart`, and `show_chart` have specialized rendering; system-source `read_skill` is suppressed. `create_chart` registers only; `show_chart` emits a chart placement without generic tool chrome.
- **Interrupts**: LangGraph interrupts arrive via `handleToolError`, detected by `isGraphInterrupt(err)` and dropped (widget stays "running"); after the stream loop, `agent.getState()` collects pending interrupts → `interrupt` control event → runHost persists approvals, run → `awaiting_user`.
- **Resume**: `doResume()` rebuilds the agent from the LangGraph checkpoint and streams `Command({ resume })`. Re-invoked interrupted tools (widget already exists) are suppressed in `handleToolStart` by stable LLM `tool_call_id`; new tools emit normally.
- Firefox AI detection is a synthetic `tool_call_started` with `status:"success"`, `toolType:"firefoxAI"`.

## Other event families

| Event(s)                                         | Notes                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `response`                                       | Assistant tokens (through `neutralizeSpoofedFences`); buffered client-side                                                                                                                              |
| `todo_update`                                    | `{ data: { todos: [{content,status}] } }` → transient `TodoWidget` above the input (clears on completion, not persisted)                                                                                |
| `subagent_started/_data/_completed/_error`       | Patch the `yaawc:subagent` widget — see `yaawc-deep-research-subagents`                                                                                                                                 |
| `panel_executor_started/_data/_completed/_error` | Patch columns in the ONE shared `yaawc:panel` widget (`startPanelColumn`/`appendPanelColumnToken`/`setPanelColumnStatus`); `_data` not persisted — see `yaawc-agent-panel`                              |
| `artifact_saved`                                 | `{ data: { artifactId, title, version, action } }` → `upsertArtifactWidget` card + opens viewer. Card written in replay too; only the `openArtifact`/`invalidateArtifacts` effects are `inReplay`-gated |
| `sources` / `sources_added`                      | Final set (replace) / streaming batches (append)                                                                                                                                                        |
| `chart_spec`                                     | Normalized canonical ChartSpec keyed by private `chartId`, with the current-turn handle for reconstruction                                                                                              |
| `chart_placement`                                | Writer-owned `yaawc:chart` placement keyed by unique placement id; only a registered current-turn chart can be shown, and repeats are allowed                                                           |
| `panel_executor_chart`                           | Structured chart placement bridged into the originating executor column; executor registries and private ids remain namespaced                                                                          |
| `workspace_file_changed`                         | Invalidates the workspace's TanStack Query                                                                                                                                                              |
| `replay_complete`                                | Flips `inReplay` off so live tokens append (replay pre-seeds content from DB — tokens must be gated to avoid duplication)                                                                               |
| `stats` / `context_grew`                         | Live token usage / context-growth indicator                                                                                                                                                             |
| `messageEnd`                                     | Finalizes the assistant message (modelStats, searchQuery, memoriesUsed, …)                                                                                                                              |

A model that narrates a placement (`{chart_1}` or a bare `show_chart` line) instead of calling the tool still gets one: `SimplifiedAgent.emitResponse` tracks mentions (`src/lib/chart/handleMentions.ts`) and emits `chart_placement` for a chart not yet shown. Every writer strips the mention text via `stripStreamedChartTags`, so the placeholder never reaches the reader.

## Approval / interrupt events

`runHost` emits `${kind}_pending` on first observation; each has an `*_answered` companion. Wire uses canonical kinds (`ask_user`, `workspace_edit`, `workspace_create`, `skill_edit`, `code_execution`, `mcp_tool`); `normalizeStreamEvent` maps legacy aliases from persisted buffers. The reducer dedupes against the mount-time `/api/approvals/pending` fetch (`seed_approvals`) by `approvalId`. UI: approval cards (`CodeExecution`, `UserQuestionPrompt`, `WorkspaceEditApproval`, `SkillEditApproval`, `McpToolApproval`).

## Widget-builder stream

The dashboard code-widget editor uses a dedicated non-persisted SSE route (`POST /api/dashboard/widget-builder`) — same event vocabulary, `WidgetChatPanel` renders only `response` + `widget_proposal`. Details: `yaawc-dashboard-widgets`.
