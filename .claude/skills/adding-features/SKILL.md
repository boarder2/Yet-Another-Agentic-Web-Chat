---
name: adding-features
description: Use when adding or extending agent tools, LLM providers, API routes, or focus modes in YAAWC, or when asked how to add new functionality.
---

# Adding Features to YAAWC

This skill covers the established patterns for extending YAAWC's core subsystems. Follow these patterns to maintain consistency with existing code.

## Adding a New Agent Tool

Tools live in `src/lib/tools/agents/`. Each tool follows a consistent pattern.

### Step-by-step

1. **Create the tool file** (`src/lib/tools/agents/myTool.ts`):

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getCurrentTaskInput } from '@langchain/langgraph';
import { Command } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { ToolMessage } from '@langchain/core/messages';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { isSoftStop } from '@/lib/utils/runControl';

const myToolSchema = z.object({
  query: z.string().describe('The search query'),
});

export const myTool = tool(
  async (input, config) => {
    // Access infrastructure from config
    const systemLlm = config.configurable?.systemLlm;
    const embeddings = config.configurable?.embeddings;
    const emitter = config.configurable?.emitter;
    const messageId = config.configurable?.messageId as string | undefined;

    // Access current agent state
    const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;

    // Check soft-stop before doing expensive work
    if (messageId && isSoftStop(messageId)) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Aborted',
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall.id,
            }),
          ],
        },
      });
    }

    // Do the work...
    const documents: Document[] = [];
    const summary = 'Results...';

    // Return Command to merge documents into state
    return new Command({
      update: {
        relevantDocuments: documents,
        messages: [
          new ToolMessage({
            content: summary,
            tool_call_id: (config as unknown as { toolCall: { id: string } })
              ?.toolCall.id,
          }),
        ],
      },
    });
  },
  {
    name: 'my_tool',
    description: 'Description shown to the LLM agent for tool selection',
    schema: myToolSchema,
  },
);
```

2. **Register in tool index** (`src/lib/tools/agents/index.ts`):

```typescript
import { myTool } from './myTool';

// Add to the appropriate static arrays:
export const allAgentTools = [...existing, myTool];
export const webSearchTools = [...existing, myTool]; // if web-search relevant
```

Tool arrays and their usage:

- `allAgentTools` — all tools (used by webSearch mode when no files attached)
- `webSearchTools` — web search mode (excludes fileSearchTool)
- `fileSearchTools` — `[fileSearchTool]` only; appended to other sets when files are present
- `coreTools` — chat mode; includes `imageGenerationTool`, `chatHistorySearchTool`, `getChatMessagesTool`, `readSkillTool` (NOT empty)

Interactive tools (`codeExecutionTool`, `askUserTool`, `editSkillTool`) are NOT in the static arrays. They are appended at runtime by `withInteractiveTools()`. Use the dynamic getters (`getAllAgentTools()`, `getWebSearchTools()`, `getCoreTools()`, `getLocalResearchTools()`) when building tool lists at runtime.

3. **Add icon/label handling** in `src/components/MarkdownRenderer.tsx`:

   The `ToolCall` component uses two `switch`/`if` blocks — `getIcon()` (returns an icon JSX for the tool type string) and `formatToolMessage()` (returns the full label row). Add cases for your tool's `type` string in both. There is no `iconMap` object; the icon is selected via a `switch` statement in `getIcon()`.

### Key conventions

- Import state type as `SimplifiedAgentStateType` from `@/lib/state/chatAgentState` (type alias, not `SimplifiedAgentState.State`)
- Use `config.configurable.systemLlm` for any internal LLM calls (NOT the chat LLM)
- Return `Command` with `update: { relevantDocuments, messages }` — documents merge into agent state via append reducer
- Always include a `ToolMessage` in the returned messages; get the id via `(config as unknown as { toolCall: { id: string } })?.toolCall.id` (there is no `config.toolCallId`)
- Check `messageId && isSoftStop(messageId)` before starting expensive operations
- Check `config.configurable.retrievalSignal?.aborted` for hard cancellation
- Tool call UI rendering is automatic via the `ToolCall` component in `MarkdownRenderer.tsx` — tool attributes (`query`, `url`, etc.) are extracted by `handleToolStart` in `simplifiedAgent.ts`

### Emitting extra data from tools

If your tool needs to emit additional events (like `todoListTool` emits `todo_update`):

```typescript
const emitter = config.configurable?.emitter;
emitter?.emit('data', JSON.stringify({
  type: 'my_custom_event',
  data: { ... },
}));
```

## Adding a New LLM Provider

Providers live in `src/lib/providers/`. Each follows a consistent fetch-and-register pattern.

### Step-by-step

1. **Create provider file** (`src/lib/providers/myProvider.ts`):

```typescript
import { getMyProviderApiKey } from '../config';

export const PROVIDER_INFO = {
  key: 'myprovider',
  displayName: 'My Provider',
};

export const loadMyProviderChatModels = async () => {
  const apiKey = getMyProviderApiKey();
  if (!apiKey) return {};

  try {
    // Fetch available models from provider API
    const response = await fetch('https://api.myprovider.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json();

    return data.models.reduce((acc, model) => {
      acc[model.id] = {
        displayName: model.name,
        model: new ChatMyProvider({ apiKey, model: model.id }),
      };
      return acc;
    }, {});
  } catch (err) {
    return {}; // Graceful degradation — provider unavailable
  }
};
```

2. **Add config getter** in `src/lib/config.ts`:
   - Add to the `Config` interface under `MODELS`
   - Export a getter function: `export const getMyProviderApiKey = () => loadConfig().MODELS.MYPROVIDER?.API_KEY;`

3. **Register in provider index** (`src/lib/providers/index.ts`):
   - Import `PROVIDER_INFO` and add to `PROVIDER_METADATA` object (it's a keyed object, not an array)
   - Import the loader and add to `chatModelProviders` map
   - Optionally add to `embeddingModelProviders` if the provider supports embeddings

4. **Add TOML config section** in `config.toml`:

```toml
[MODELS.MYPROVIDER]
API_KEY = ""
```

### Key conventions

- Models are fetched dynamically from the provider API (not hardcoded)
- Return `{}` on any error (graceful degradation)
- Filter out non-chat models (audio, embedding, etc.) in the loader
- Use LangChain's provider-specific classes (`ChatOpenAI`, `ChatAnthropic`, etc.)
- `PROVIDER_METADATA` in `src/lib/providers/index.ts` is a plain object keyed by provider key, not an array

## Adding a New API Route

API routes use the Next.js App Router pattern.

### Step-by-step

1. **Create route file** (`src/app/api/myEndpoint/route.ts`):

```typescript
import { NextResponse } from 'next/server';

export const POST = async (request: Request) => {
  try {
    const body = await request.json();
    // Validate input...
    // Process...
    return NextResponse.json({ result: '...' });
  } catch (err: any) {
    return NextResponse.json({ message: 'An error occurred' }, { status: 500 });
  }
};
```

For streaming responses, see the chat route pattern (`src/app/api/chat/route.ts`):

- Use `TransformStream` with a `writer` for server-push
- Set `Content-Type: text/event-stream`
- Write JSON lines: `writer.write(encoder.encode(JSON.stringify({ type, data }) + '\n'))`

### Key conventions

- Export named HTTP method functions (`POST`, `GET`, `DELETE`)
- Always wrap in try/catch with structured error responses
- Use `NextResponse.json()` for JSON responses
- Streaming endpoints use `TransformStream` with JSON lines (not SSE format)

## Adding a New Focus Mode

Focus modes control which tools and prompts the agent uses.

### Step-by-step

1. **Register the mode** in `src/lib/focusModes.ts`:
   - Add an entry to the `focusModes` array with `key`, `title`, and `description`

2. **Create prompt** (`src/lib/prompts/simplifiedAgent/myMode.ts`):
   - Export a system prompt string for the new mode
   - Import and use templates from `src/lib/prompts/templates.ts` for citation formatting

3. **Add tool selection** in `src/lib/search/simplifiedAgent.ts`:
   - In the private `getToolsForFocusMode()` method, add a `case` for your focus mode returning the appropriate tool set from `getAllAgentTools()`, `getWebSearchTools()`, `getCoreTools()`, or `getLocalResearchTools()`
   - In the prompt selection block (search for the `switch (focusMode)` that sets the system prompt), add a case returning your new prompt

4. **Add UI button** in `src/components/MessageInputActions/Focus.tsx`:
   - Focus modes are rendered from the `focusModes` array imported from `src/lib/focusModes.ts` — adding an entry there is sufficient; no manual button code required

5. **Update API validation** in `src/app/api/chat/route.ts` if you need strict validation of the focus mode string (currently the route passes the string through without an allow-list check)
