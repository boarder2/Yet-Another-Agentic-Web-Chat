---
name: yaawc-adding-features
description: Use when adding agent tools, LLM providers, API routes, or focus modes, or when asked how to add new functionality.
---

# Adding Features

Established recipes for extending the core subsystems. Match existing files in each directory.

## New Agent Tool (`src/lib/tools/agents/`)

1. **Create the tool** with `defineTool` (`src/lib/tools/defineTool.ts`) — it validates against the typed `ToolContext` (`toolContext.ts`), enforces soft-stop before the handler runs, and provides `runtime.persist(...)`:

```typescript
export const myTool = defineTool(
  async (input, runtime) => {
    const { systemLlm, embeddings, emitter } = runtime.context; // typed ToolContext
    const state = getCurrentTaskInput() as SimplifiedAgentStateType;
    // work…
    return new Command({
      update: {
        relevantDocuments: documents, // merges via append reducer
        messages: [new ToolMessage({ content: summary, tool_call_id: runtime.toolCallId })],
      },
    });
  },
  { name: 'my_tool', description: '…shown to the LLM…', schema: z.object({ … }) },
);
```

2. **Register** in `src/lib/tools/agents/index.ts`. Static arrays: `allAgentTools` (webSearch, no files), `webSearchTools` (excludes fileSearchTool), `fileSearchTools`, `coreTools` (chat mode — includes imageGeneration, chatHistorySearch, getChatMessages, readSkill). Interactive tools (`codeExecutionTool`, `askUserTool`, `editSkillTool`) are appended at runtime by `withInteractiveTools()` — use the dynamic getters (`getAllAgentTools()`, `getWebSearchTools()`, `getCoreTools()`, `getLocalResearchTools()`) when building tool lists at runtime.

3. **Icon/label**: add cases for the tool's `type` string in `getIcon()` and `formatToolMessage()` in `src/components/MessageActions/ToolCall.tsx`. Lifecycle events and widget rendering are automatic (see `yaawc-streaming-events`); tool attrs (`query`, `url`, …) are extracted by `handleToolStart` in `simplifiedAgent.ts`.

Conventions: use `systemLlm` for internal LLM calls (never the chat LLM); emit extra events via `emitStreamEvent(runtime.context.emitter, …)` (like `todoListTool`); check `runtime.context.retrievalSignal?.aborted` in long loops for hard cancellation.

## New LLM Provider (`src/lib/providers/`)

1. Create `myProvider.ts` exporting `PROVIDER_INFO = { key, displayName }` and an async `loadMyProviderChatModels()` that fetches the model list from the provider API (not hardcoded), filters non-chat models, wraps each in the LangChain class (`ChatOpenAI`, …), and returns `{}` on any error (graceful degradation).
2. **API key is DB-backed, never config.toml** (the `MODELS` config block is legacy, read only by the one-time boot migration): add `'model.myprovider'` to `CREDENTIAL_KEYS` in `src/lib/credentials.ts`, an exported getter in `src/lib/config.ts` (`getMyProviderApiKey = () => getCredential('model.myprovider')`), and a field in Settings → API Keys (`ApiKeysSection` + `/api/config` plumbing).
3. Register: add to `PROVIDER_METADATA` in `src/lib/providers/metadata.ts` (a keyed object, deliberately import-free so client components can use it) and the `chatModelProviders` map in `src/lib/providers/index.ts`; optionally `embeddingModelProviders`.

## New API Route (`src/app/api/`)

Next.js App Router: export named `GET`/`POST`/`DELETE` handlers, try/catch with structured error JSON. Streaming responses use `TransformStream` + JSON lines — copy the chat route pattern. Route tables and payload shapes: `yaawc-api-endpoints`.

## New Focus Mode

1. Add an entry (`key`, `title`, `description`) to `focusModes` in `src/lib/focusModes.ts` — the UI buttons render from this array, no component change needed.
2. Create the system prompt in `src/lib/prompts/simplifiedAgent/` (see `yaawc-prompt-system` for the layering).
3. In `src/lib/search/simplifiedAgent.ts`: add a `case` in `getToolsForFocusMode()` returning a tool set from the dynamic getters, and a `case` in the prompt-selection `switch` in `createEnhancedSystemPrompt()`.

The chat route passes the focus-mode string through without an allow-list check; unknown modes fall through to `webSearch` with a console warning.
