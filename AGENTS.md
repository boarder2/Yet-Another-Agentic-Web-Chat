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

## Dashboard Widgets

- Two widget kinds (`src/lib/types/widget.ts`): LLM-transformed and user-JS (Docker sandbox, gated on code execution). Processed via `/api/dashboard/*`; sources fetched server-side (`src/lib/dashboard/sources.ts`), output sanitized (`sanitizeWidgetOutput.ts`) and rendered by `WidgetContent.tsx`.
- Rendered on two surfaces — `/dashboard` and the home page (`EmptyChat`) — with per-widget placement flags and a layout per surface. Both share `useWidgetBoard` (`src/lib/hooks/`), with board UI in `src/components/dashboard/`.
- Code-widget contract (`render({ sources, now, location, theme })`) lives in `widgetTheme.ts`; widgets persist localStorage → DB.

## Settings

- `config.toml` holds **only** secrets/infra (API keys, DB, search). No model selection lives there — all of it is DB-backed (`app_settings`) or request-supplied.
- Non-secret settings sync localStorage ⇄ DB via `src/lib/settings/persist.ts` (the durable source of truth is the DB); secrets and device-local UI prefs are excluded. Keep using `useLocalStorage*` — call sites are unchanged.
- Model selection UI: `ModelPicker` (`src/components/models/`); embedding/memory model keys read server-side via helpers in `src/lib/settings/server.ts`.

## Conventions

- TypeScript strict, ES2017, `@/*` → `src/*`
- Package manager: **yarn** — use `yarn <script>` for all commands
- Prettier + ESLint (Next.js core web vitals); run `yarn format:write` before commits
- React functional components, one per file; camelCase funcs/vars, PascalCase components
- try/catch for async, structured error responses from API routes
- Terse, factual responses; ask when requirements are unclear
- Ask before adding dependencies
- Scope changes to the specific task; follow existing patterns
- Keep AGENTS.md reflecting the **current** state of the project — but reserve it for architecture and big-picture pointers (subsystems, data flow, where things live). Do **not** add implementation minutiae (specific CSS classes, pixel constants, opacity math, individual handlers, scroll listeners); those belong in the code/comments and become stale fast. If an entry reads like a code comment, it's too detailed.
- Keep the skills in `.claude/skills/**` up to date as the application changes — when a change affects a subsystem documented by a skill (see Subsystem Skills), update that skill's `SKILL.md` in the same change so it stays accurate
- DB schema changes: edit `src/lib/db/schema.ts` only; run `yarn db:generate` to emit the drizzle migration — never hand-write files in `drizzle/`

## Commands

- `yarn dev` — dev server (turbopack); prefers :3000, auto-bumps to next free port — read the bound port from the log
- `yarn build` — `db:push` (drizzle migrate + push) then `next build`; needs a working `db.sqlite`. `yarn start` serves the build
- `yarn lint` (ESLint) / `yarn format:write` (Prettier, before commits) / `npx tsc --noEmit` (typecheck, no script). Pre-commit hook runs Prettier + ESLint on staged files
- `yarn db:generate` after editing `src/lib/db/schema.ts`; `yarn db:push` to apply
- No unit/`yarn test` suite (`e2e/` is scaffolding only) — verify by running the app: `bash .claude/skills/run-yaawc/smoke.sh` (snapshots home + settings; grep the YAML, not the exit code), or drive it with the `playwright-cli` skill. API smoke: `curl -s localhost:3000/api/config` must contain `chatModelProviders`
- Setup: if there's no `config.toml`, `cp sample.config.toml config.toml` (secrets/infra only) — **never overwrite an existing `config.toml`**; then `yarn install`. Code execution / code widgets need Docker

## Data Fetching

Client-side server state uses **TanStack Query** (provider in `src/app/providers.tsx`). Don't `fetch` directly in components — use or add a hook in `src/lib/hooks/api/` (e.g. `useChats`, `useWorkspaces`). Hooks call the shared `apiFetch`/`ApiError` helper in `src/lib/api/client.ts` and use query keys from `qk` in `src/lib/api/keys.ts`. Mutations should invalidate the relevant keys.

## Subsystem Skills

Load on demand: `api-endpoints`, `streaming-events`, `subagent-architecture`, `image-attachments`, `adding-features`, `frontend-architecture`, `prompt-system`, `test-automation`, `playwright-cli`.

## External Docs

- context7: `/quantizor/markdown-to-jsx`, `/context7/headlessui_com`, `/tailwindlabs/tailwindcss.com`, `/vercel/next.js`
- `docs-langchain` tool for LangChain/LangGraph

## Documentation Style

- Keep all documentation and README additions terse — prefer minimal facts over verbose prose. Match the brevity of surrounding sections and avoid bloated first drafts
