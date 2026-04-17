# Project Overview

YAAWC (Yet Another Agentic Web Chat) is an open-source AI-powered search engine combining web search with LLM-based processing.

## Architecture

User query → API route → `SimplifiedAgent` (LangGraph React Agent) uses tools to research → streams response with cited sources.

- **Chat Model**: agent reasoning, final answer, streamed output
- **System Model**: tools and internal chains (URL summarization, query generation, task breakdown)

Stack: Next.js (App Router) + React 19 + Tailwind 4, LangChain/LangGraph, SQLite+Drizzle, SearXNG, Xenova embeddings, optional LangFuse tracing. Config via `config.toml` (copy from `sample.config.toml`). LLM providers: OpenAI, Anthropic, Groq, Ollama, Gemini, DeepSeek, LM Studio.

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

## Subsystem Skills

Load on demand: `api-endpoints`, `streaming-events`, `subagent-architecture`, `image-attachments`, `adding-features`, `frontend-architecture`, `prompt-system`, `test-automation`, `playwright-cli`.

## External Docs

- context7: `/quantizor/markdown-to-jsx`, `/context7/headlessui_com`, `/tailwindlabs/tailwindcss.com`, `/vercel/next.js`
- `docs-langchain` tool for LangChain/LangGraph
