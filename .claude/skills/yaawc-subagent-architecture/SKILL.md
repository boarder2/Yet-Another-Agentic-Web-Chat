---
name: yaawc-subagent-architecture
description: Use when working on the deep_research tool, SubagentExecutor, subagent tool restrictions, or subagent event flow.
---

# Subagent Architecture

The main agent calls `deep_research` as an ordinary tool when it discovers complexity mid-research — no pre-routing, no decomposition overhead on simple queries. Each call researches ONE narrow aspect; multi-part questions get one call per aspect, with task descriptions naming the specific entities discovered (never "the remaining items").

## Flow

```
SimplifiedAgent → deep_research tool (deepResearchTool.ts)
  → SubagentExecutor (src/lib/search/subagents/executor.ts)
    → child SimplifiedAgent on an isolated EventEmitter
      · tools filtered to the definition's allowedTools whitelist
        (web_search, url_fetch, image_search, image_analysis, pdf_loader —
        no deep_research, so no recursion; artifact and chart tools dropped from
        the pool by filterSubagentTools — they anchor to a parent chat/message
        or writer stream the child doesn't have)
      · last 5 messages of context; Chat Model; maxTurns cap
      · empty personaInstructions — behavior comes only from the definition's
        systemPrompt; userLocation/userProfile forwarded for search context
      · events forwarded to the parent as subagent_data
  → documents + summary return via Command; findings persisted via
    runtime.persist (kind: deep_research)
```

Definitions (system prompt, allowedTools, model, maxTurns) are hardcoded in `src/lib/search/subagents/definitions.ts` — currently only `deep_research`, registered in `webSearchTools`/`allAgentTools` (web search mode only). The tool description instructs the agent to `read_skill("deep-research")` before first use. Executions are ephemeral (not stored in the DB beyond the message widget).

## Token tracking

The tool passes the turn's shared `TokenTracker` and root model identities into the executor, which registers chat/system `Recorder`s under `scope: 'subagent:<executionId>'`. Each LLM call emits a live `model_stats` snapshot to the root stream; on completion `tokenUsage = tracker.scopeUsage(scope)`.

## UI & events

One `yaawc:subagent` widget per execution (`{ id, name, task, status, toolCalls, responseText?, summary?, error?, tokenUsage? }`) — nested tool calls are a typed **array** field, not nested markup (immune to the markdown block-splitting bug the legacy tags had). `subagent_started` appends the widget; `subagent_data` patches `toolCalls`/`responseText` via `upsertNestedToolCall`/`patchNestedToolCall`; `subagent_completed`/`_error` set terminal status. Both writers (client reducer, server `runHost`) share the codec — event payloads in `yaawc-streaming-events`, codec in `src/lib/widgets/envelope.ts`.

`SubagentExecution.tsx` renders it: collapsed (name, truncated task, status icon) / expanded (full task, nested `ToolCall`s always visible, one collapsible "Response" section — final summary when available, streaming text until then).

`run-ID attribution` sets in `simplifiedAgent.ts` (`deepResearchRunIds`, `parentToolsNodeRunIds`, `activeAgentLlmRunIds`) keep child events out of the parent's tool-call/token streams — LangChain's `AsyncLocalStorage` propagates parent callbacks into nested executions.

## Related: Agent Panel

`PanelCoordinator` reuses the isolated-emitter pattern but is a user-selected composer mode, not agent-invoked: `panel_executor_*` events, one shared `yaawc:panel` widget. See `yaawc-agent-panel`.
