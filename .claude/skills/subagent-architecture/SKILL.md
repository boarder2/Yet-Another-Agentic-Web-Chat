---
name: subagent-architecture
description: Use when working on the deep_research tool, subagents, SubagentExecutor, SubagentExecution UI, subagent tool restrictions, or subagent event flow.
---

# Subagent Architecture

The main `SimplifiedAgent` has access to a `deep_research` tool that it can invoke on demand when it discovers a query requires deeper investigation. Subagents are not pre-routed — the main agent decides when to use them based on what it learns during research.

## Design Principles

- **No front-loaded overhead**: Simple queries go directly to the main agent without any decomposition LLM call
- **Agent-driven invocation**: The main agent calls `deep_research` as a tool when it discovers complexity mid-research
- **Progressive discovery**: The agent can research first with basic tools, then spawn subagents when it identifies sub-problems needing deeper investigation

## Available Subagents

1. **Deep Research** (`deep_research`)
   - Purpose: Focused investigation of a specific, narrow aspect of a larger question
   - Tools: `web_search`, `url_fetch`, `image_search`, `image_analysis`, `pdf_loader`
   - Model: Chat Model (needs reasoning capability)
   - Invoked by: Main agent via `deep_research` tool
   - **Key Principle**: Each call should research ONE specific aspect, not try to answer the entire user question
   - Use Cases:
     - Iterative research: discover scope first, then research specific items in follow-up calls
     - Multi-part queries with 2+ distinct questions (each aspect gets its own subagent call)
     - Comparative analysis ("compare X and Y" → separate subagents for X and Y)
     - Comprehensive queries asking about multiple aspects ("tell me everything about X including Y, Z, W")
     - Complex research topics where user explicitly requests detailed research
   - Iterative Pattern:
     1. Use an initial deep_research (or web_search) to discover the scope/landscape
     2. Based on findings, launch targeted deep_research calls for specific items or groups — task descriptions MUST include the specific entities/items discovered (e.g., name the actual sports, providers, or categories found), never use generic references like "remaining items" or "all finished sports"
     3. Synthesize all findings into a comprehensive final answer

## Architecture

```
User Query → SimplifiedAgent (with all tools including deep_research)
                    ↓
              [Agent researches using web_search, url_fetch, etc.]
                    ↓
              [Discovers complexity?]
               ↓              ↓
             No              Yes
              ↓               ↓
         Respond         Call deep_research tool
                              ↓
                        SubagentExecutor
                              ↓
                        Child SimplifiedAgent (without deep_research)
                              ↓
                        Results flow back to main agent
                              ↓
                         Respond with integrated findings
```

### Key Components

- **Deep Research Tool** (`src/lib/tools/agents/deepResearchTool.ts`)
  - LangGraph tool wrapping SubagentExecutor
  - Returns documents and summary via Command pattern
  - Prevents recursion: subagent's allowedTools excludes `deep_research`
  - On success, persists findings via `runtime.persist(...)` (kind: `deep_research`)
  - Passes the turn's shared `TokenTracker` (`ctx.tracker`) and the root chat/system model identities (`tracker.rootIdentity('chat'/'system')`) into `SubagentExecutor`
  - Tool description instructs the agent to call `read_skill("deep-research")` before first use

- **SubagentExecutor** (`src/lib/search/subagents/executor.ts`)
  - Wraps SimplifiedAgent with subagent-specific configuration
  - Enforces tool restrictions via allowedTools whitelist, on a pool that already drops the artifact tools — those anchor to the parent turn's chat and assistant message, which a subagent run has neither of
  - Provides isolated event streaming with subagent context
  - Passes empty `personaInstructions` to SimplifiedAgent — subagent behavior is controlled entirely by `customSystemPrompt` from the subagent definition, NOT by persona/formatting instructions
  - Forwards `userLocation`/`userProfile` from the parent agent for location-aware research
  - Registers its own chat/system `Recorder`s on the shared tracker under `scope: 'subagent:<executionId>'`; `SubagentExecution.tokenUsage` is `tracker.scopeUsage(scope)` (the frozen `PanelUsage`-shaped chat/system split) — see `src/lib/tokens/tracker.ts`

- **Definitions** (`src/lib/search/subagents/definitions.ts`)
  - Subagent configurations (system prompt, allowed tools, model selection)
  - Currently defines only `deep_research`

- **Widget codec** (`src/lib/widgets/envelope.ts`)
  - The subagent's UI state is a single `yaawc:subagent` fenced-JSON widget (`{ id, name, task, status, toolCalls, responseText?, summary?, error?, tokenUsage? }`) — nested tool calls are a typed **array** field, not nested markup, which is what makes them immune to the markdown-parser block-splitting bug nested `<ToolCall>` tags used to hit
  - `upsertNestedToolCall`/`patchNestedToolCall` insert/update an entry in the `toolCalls` array (idempotent on id); `updateWidget` (with an updater function) applies them, accumulates `responseText`, and sets the terminal `status`/`summary`/`error`
  - Shared by the live streaming handler (`reducer.ts`) and the server persistence handler (`runHost.ts`) to keep both paths consistent

## Execution Flow

1. Main agent receives query and begins research with standard tools
2. Agent determines a sub-problem needs deeper investigation
3. Agent calls `deep_research` tool with a specific task description
4. `deepResearchTool` creates a `SubagentExecutor` with the `deep_research` definition
5. SubagentExecutor spawns a child `SimplifiedAgent` with:
   - Isolated EventEmitter (forwards events to parent as `subagent_data`)
   - Filtered tools (web_search, url_fetch, image_search, image_analysis, pdf_loader — no deep_research)
   - Limited context (last 5 messages)
   - Chat Model for reasoning
6. Child agent researches independently and streams tool events; its `Recorder`s (registered on the shared `TokenTracker` under the subagent's `scope`) record usage as LLM calls complete, each emitting a live `model_stats` snapshot straight to the turn's root stream
7. After the child agent finishes, SubagentExecutor reads `tracker.scopeUsage(scope)` and returns it as `SubagentExecution.tokenUsage`
8. On success, `deepResearchTool` persists the summary via `runtime.persist(...)` (kind: `deep_research`)
9. Results (documents + summary) return to the main agent via Command pattern
10. Main agent integrates findings into its final response

## UI Integration

Subagent activity is displayed in real-time via the `SubagentExecution` component (`src/components/MessageActions/SubagentExecution.tsx`):

- **Collapsed State**: Shows subagent name, task (truncated), and status icon (spinner/check/X)
- **Expanded State**: Shows full task instructions (not truncated), nested tool calls, collapsible response, and error (if any)
- **Tool Calls**: Always visible when present, regardless of subagent status (running, success, or error). Tool calls are persisted in the message content so they survive page reloads and history loading.
- **Response**: A single unified "Response" section (collapsible) that shows the subagent's markdown output. Uses the final summary when available, falls back to the streaming response text during execution. There is no separate "Result" display — it's all one consistent section.
- **Status Indicators**:
  - `running`: Animated spinner
  - `success`: Green checkmark
  - `error`: Red X + error message

Streaming events:

- `subagent_started`: Appends a `yaawc:subagent` widget with running status and an empty `toolCalls` array
- `subagent_data`: Nested events (tool calls, response tokens) forwarded to parent with subagent context; nested tool calls are upserted/patched into the widget's `toolCalls` array in both client state and server-side `recievedMessage` for history
- `subagent_completed`/`subagent_error`: Patches the widget with final status, summary/error, and results

## Tool Restrictions

The deep_research subagent has a whitelist of allowed tools enforced at execution time:

```typescript
allowedTools: [
  'web_search',
  'url_fetch',
  'image_search',
  'image_analysis',
  'pdf_loader',
];
```

Tools are filtered in `SubagentExecutor.getFilteredTools()` before passing to SimplifiedAgent. The `deep_research` tool itself is excluded, preventing recursive subagent spawning.

## Configuration

Subagent definitions are in `src/lib/search/subagents/definitions.ts`:

```typescript
export interface SubagentDefinition {
  name: string; // Display name
  description: string; // Purpose description
  systemPrompt: string; // Custom system prompt
  allowedTools: string[]; // Whitelist of tool names
  useSystemModel: boolean; // true = System Model, false = Chat Model
  maxTurns: number; // Max iterations before forced stop
  parallelizable: boolean; // Can run concurrently with others
}
```

## Integration Points

The `deep_research` tool is registered in `src/lib/tools/agents/index.ts` and included in the `webSearchTools` and `allAgentTools` arrays. It is available to the main agent in web search mode.

The chat API route creates `SimplifiedAgent` directly — no supervisor or pre-routing.

## Event Flow

```
API Route → SimplifiedAgent
                              ↓
                    [Agent calls deep_research tool]
                              ↓
                    SubagentExecutor (isolated EventEmitter)
                              ↓
                    Child SimplifiedAgent → tool events
                              ↓
                    Isolated emitter forwards as subagent_data
                              ↓
                    Parent emitter → API Route → ChatWindow
                              ↓
                    MarkdownRenderer (SubagentExecution component)
```

## Related: Agent Panel

The **Agent Panel** (`src/lib/search/panel/coordinator.ts`) reuses this isolated-emitter + markup-persistence pattern, but is distinct from agent-invoked `deep_research`: it is a user-selected composer mode that fans the prompt across 2–4 executor `SimplifiedAgent`s in parallel (each with a non-prompting research toolset via `tools/panel/restrictedToolset.ts`) and then has the turn's chat model synthesize their results. Events are `panel_executor_*` (not `subagent_*`); markup is a single `<PanelColumns>` block (not per-execution `<SubagentExecution>`). See CLAUDE.md → Agent Panel.

## Constraints

- Each subagent sees only last 5 messages (limited context window)
- Max turns configurable per subagent definition to prevent runaway execution
- No recursive subagents — flat hierarchy only (deep_research excluded from child tools)
- Subagent executions are ephemeral (not stored in database)
- deep_research tool only available in web search mode
- Subagent definitions are hardcoded (no UI for custom subagents)
