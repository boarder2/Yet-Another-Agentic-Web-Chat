# Project Overview

YAAWC (Yet Another Agentic Web Chat) is an open-source AI-powered search engine that uses advanced machine learning to provide intelligent search results. It combines web search capabilities with LLM-based processing to understand and answer user questions.

## Architecture

User submits a query → `/api/chat` route → `createDeepAgent` (from `deepagents`) runs as a LangGraph agent with tools → SSE stream consumed by `useStream` + `FetchStreamTransport` in `ChatWindow.tsx`.

- **Chat Model**: Agent reasoning, final answer generation, streamed user-facing output
- **System Model**: Tool-internal chains (URL summarization, query generation) — passed via `configurable.systemLlm`
- **Agent construction**: `createDeepAgent` in `src/lib/agent/factory.ts` — static at startup, model injected per-request
- **Streaming**: LangGraph SSE format (`event: {mode}\ndata: {json}\n\n`); subgraph events include namespace (`event: {mode}|{ns_0}|{ns_1}`)
- **Checkpointing**: Per-request `MemorySaver` scoped to `chatId:aiMessageId` thread; full chat history loaded from DB and passed as `allMessages`
- **Subagents**: `task` tool built into `createDeepAgent`; deep research subagent defined in `src/lib/agent/subagents.ts`; frontend identifies via `subagentToolNames: ['task']` and shows an immediate placeholder from the `task` tool call until live `stream.subagents` state arrives
- **Todos**: `TodoListMiddleware` included by default; state key `todos: Array<{ content, status }>` surfaced via `stream.values.todos`

### Technology Stack

- **Frontend**: React 19, Next.js (App Router), Tailwind CSS 4, Headless UI
- **Backend**: Node.js, LangChain + LangGraph
- **Database**: SQLite with Drizzle ORM (`src/lib/db/schema.ts`, tables: `messages`, `chats`, `systemPrompts`)
- **Search**: SearXNG integration (`src/lib/searxng.ts`)
- **Content Processing**: Mozilla Readability, Cheerio, Playwright
- **LLM Providers**: OpenAI, Anthropic, Groq, Ollama, Gemini, DeepSeek, LM Studio
- **Embeddings**: Xenova Transformers (cosine/dot product similarity)
- **Tracing**: LangFuse integration (optional, `src/lib/tracing/`)
- **Configuration**: TOML-based (`config.toml` from `sample.config.toml`)

## Project Structure

- `/src/app` — Next.js pages and API routes (`/src/app/api`)
- `/src/components` — React UI components (see **frontend-architecture** skill)
- `/src/lib/agent` — Agent construction and tools:
  - `factory.ts` — `createAgent()` call to `createDeepAgent` with focus-mode tool sets
  - `subagents.ts` — Deep research subagent definition (passed to `createDeepAgent`)
  - `tools/` — Custom tool implementations (`webSearchTool`, `urlSummarizationTool`, `fileSearchTool`, `imageSearchTool`, `imageAnalysisTool`, `pdfLoaderTool`, `youtubeTranscriptTool`)
- `/src/lib/providers` — LLM and embedding model integrations (see **adding-features** skill)
- `/src/lib/prompts` — Prompt templates including `prompts/simplifiedAgent/*` (see **prompt-system** skill)
- `/src/lib/db` — Database schema and operations
- `/src/lib/chains` — Specialized chains (image/video search helpers)
- `/src/lib/utils` — Utility functions, web content retrieval, personalization
- `/src/app/dashboard` — Dashboard page with configurable widgets

## Focus Modes

- **Web Search**: General web search with all tools (default)
- **Local Research**: Research local files with citations (file_search tool)
- **Chat**: Creative conversation, no tools
- **Firefox AI**: Auto-detected; tools disabled, conversational response

## Extending the System

### Adding a custom tool

1. Create `src/lib/agent/tools/myTool.ts` using `tool()` from `@langchain/core/tools`.
2. Use `config?.configurable?.embeddings`, `systemLlm`, `messageId`, `retrievalSignal` from `RunnableConfig` for dependencies.
3. Emit custom events with `writer({ type: 'my_event', ... })` from `@langchain/langgraph` when `streamMode: ['custom']` is active.
4. Export and add the tool to `src/lib/agent/tools/index.ts`.
5. Include it in the appropriate tool array in `src/lib/agent/factory.ts` (`webSearchTools`, `localResearchTools`, or `allTools`).

### Adding a focus mode

1. In `src/lib/agent/factory.ts`, add a branch matching the new `focusMode` string.
2. Define a tool set and a `systemPrompt` string for it.
3. Call `createDeepAgent({ model: chatLlm, tools, systemPrompt, subagents, checkpointer })`.
4. Add the focus mode selector option in `src/components/MessageInputActions/Focus.tsx`.

### Adding a subagent

1. In `src/lib/agent/subagents.ts`, add an entry to the `subagents` array passed to `createDeepAgent`.
2. Shape: `{ name: string, description: string, system_prompt: string, tools: Tool[], model?: BaseChatModel }`.
3. The built-in `task` tool delegates to registered subagents by name. `useStream` identifies `task` tool calls as subagent events via `subagentToolNames: ['task']`.

- **Development**: `npm run dev` (Turbopack)
- **Build**: `npm run build` (includes DB push)
- **Production**: `npm run start`
- **Linting**: `npm run lint`
- **Formatting**: `npm run format:write` (Prettier)
- **Database**: `npm run db:push` (Drizzle migrations)

## Configuration

`config.toml` configures API keys, database settings, search engine, and similarity measures. The Settings page also exposes:

- Chat Model selector
- System Model selector (localStorage: `systemModelProvider`, `systemModel`)
- Link System to Chat toggle (`linkSystemToChat`, default ON — system mirrors chat model)

## Code Style & Standards

- **TypeScript**: Strict mode, ES2017 target, path aliases `@/*` → `src/*`
- **Formatting**: Prettier (`npm run format:write` before commits), ESLint (Next.js core web vitals)
- **Imports**: Use `@/` prefix for internal imports
- **Components**: React functional components with TypeScript, one per file
- **Naming**: camelCase functions/variables, PascalCase components
- **Error handling**: try/catch for async, structured error responses from API routes
- **API routes**: Next.js App Router pattern (`src/app/api/`)

## AI Behavior Guidelines

- Focus on factual, technical responses without unnecessary pleasantries
- Avoid conciliatory language and apologies
- Ask for clarification when requirements are unclear
- Do not add dependencies unless explicitly requested
- Only make changes relevant to the specific task
- **Do not create test files or run the application unless requested**
- **Do not run a build to check for errors unless requested**
- Prioritize existing patterns and architectural decisions
- Always update documentation and comments to reflect code changes
- Always update `AGENTS.md` to reflect relevant changes to AI guidelines. This file should **only** reflect the **current** state of the project and should not be used as a historical log.
- When personalization is active, honor the guardrails: location may bias retrieval; About Me is for tone/context only, never sent to external tools verbatim.

## Subsystem References

Detailed documentation lives in skills — loaded on demand when relevant:

- **image-attachments** — Upload/serving endpoints, multimodal LLM messages, clipboard paste, security
- **test-automation** — Static analysis, curl API testing, playwright-cli browser automation
- **playwright-cli** — Browser interaction tool reference

## Available Tools and Help

- Use the context7 tool with these library identifiers:
  - `/quantizor/markdown-to-jsx` for Markdown to JSX conversion
  - `/context7/headlessui_com` for Headless UI components
  - `/tailwindlabs/tailwindcss.com` for Tailwind CSS documentation
  - `/vercel/next.js` for Next.js documentation

- Use the `docs-langchain` tool to query documentation for LangChain or LangGraph when implementing or modifying agents and chains.
