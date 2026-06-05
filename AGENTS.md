# Project Overview

YAAWC (Yet Another Agentic Web Chat) is an open-source AI-powered search engine combining web search with LLM-based processing.

## Architecture

User query → API route → `SimplifiedAgent` (LangGraph React Agent) uses tools to research → streams response with cited sources.

- **Chat Model**: agent reasoning, final answer, streamed output
- **System Model**: tools and internal chains (URL summarization, query generation, task breakdown)

Stack: Next.js (App Router) + React 19 + Tailwind 4, TanStack Query (client data fetching), LangChain/LangGraph, SQLite+Drizzle, SearXNG, Xenova embeddings, optional LangFuse tracing. Config via `config.toml` (copy from `sample.config.toml`). LLM providers: OpenAI, Anthropic, Groq, Ollama, Gemini, DeepSeek, LM Studio.

## Focus Modes

- **Web Search**: default, all tools
- **Local Research**: file_search with citations
- **Chat**: conversational only
- **Firefox AI**: auto-detected, conversational only

## Settings

`config.toml` holds API keys, DB, search, similarity. Settings page also exposes Chat Model, System Model (`systemModelProvider`, `systemModel` in localStorage), and Link System to Chat toggle (`linkSystemToChat`, default ON).

## Conventions

- TypeScript strict, ES2017, `@/*` → `src/*`
- Package manager: **yarn** — use `yarn <script>` for all commands
- Prettier + ESLint (Next.js core web vitals); run `yarn format:write` before commits
- React functional components, one per file; camelCase funcs/vars, PascalCase components
- try/catch for async, structured error responses from API routes
- Terse, factual responses; ask when requirements are unclear
- Ask before adding dependencies
- Scope changes to the specific task; follow existing patterns
- Keep AGENTS.md reflecting the **current** state of the project
- Keep the skills in `.claude/skills/**` up to date as the application changes — when a change affects a subsystem documented by a skill (see Subsystem Skills), update that skill's `SKILL.md` in the same change so it stays accurate
- DB schema changes: edit `src/lib/db/schema.ts` only; run `yarn db:generate` to emit the drizzle migration — never hand-write files in `drizzle/`

## Data Fetching

Client-side server state uses **TanStack Query** (provider in `src/app/providers.tsx`). Don't `fetch` directly in components — use or add a hook in `src/lib/hooks/api/` (e.g. `useChats`, `useWorkspaces`). Hooks call the shared `apiFetch`/`ApiError` helper in `src/lib/api/client.ts` and use query keys from `qk` in `src/lib/api/keys.ts`. Mutations should invalidate the relevant keys.

## Subsystem Skills

Load on demand: `api-endpoints`, `streaming-events`, `subagent-architecture`, `image-attachments`, `adding-features`, `frontend-architecture`, `prompt-system`, `test-automation`, `playwright-cli`.

## External Docs

- context7: `/quantizor/markdown-to-jsx`, `/context7/headlessui_com`, `/tailwindlabs/tailwindcss.com`, `/vercel/next.js`
- `docs-langchain` tool for LangChain/LangGraph
