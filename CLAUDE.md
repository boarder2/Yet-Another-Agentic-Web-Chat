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

## Agent Panel

Optional composer mode (research modes only) that fans one prompt across **2–4 executor models in parallel** (`PanelCoordinator`, `src/lib/search/panel/`), then has the **turn's chat model** synthesize one answer. Request shape: `body.panel` (`src/lib/types/panel.ts`); wired in `api/chat/route.ts`.

## MCP Servers

Remote MCP servers (Settings → MCP Servers) whose tools are injected into every tool-running focus mode, with per-tool enable/auto-run config. Connection layer + auth in `src/lib/mcp/`; API under `/api/mcp/*`.

## Dashboard Widgets

Two widget kinds (`src/lib/types/widget.ts`): LLM-transformed and user-JS (Docker sandbox). Processed via `/api/dashboard/*`, rendered on `/dashboard` and the home page (shared `useWidgetBoard`, board UI in `src/components/dashboard/`).

## Settings

`config.toml` holds **only** secrets/infra; everything else is DB-backed (`app_settings`) or request-supplied. Non-secret settings sync localStorage ⇄ DB (`src/lib/settings/`, DB is source of truth); model selection via `ModelPicker`; the settings UI is one `SettingsPanel` (`src/app/settings/`) shown as a page and a modal.

## Conventions

**Write like a lead developer. Less is more.** Favor the smallest correct change; one well-formed line over several. DRY — when logic/markup repeats, extract a function, component, or hook and reuse it rather than copy-paste. Reach for existing helpers, hooks, and patterns before inventing new ones; match the idioms of the file you're in. Prefer clear names and composition over cleverness. Comments are rare and earn their place — explain a non-obvious _why_, never restate the code; no banners, no narration, no commented-out code. Delete more than you add when you can.

- TypeScript strict, ES2017, `@/*` → `src/*`
- Package manager: **npm** — use `npm run <script>` for all commands
- Prettier + ESLint (Next.js core web vitals); run `npm run format:write` before commits
- React functional components, one per file; camelCase funcs/vars, PascalCase components
- try/catch for async, structured error responses from API routes
- Terse, factual responses; when clarification is needed, surface it via `AskUserQuestion` — never ask inline in prose
- Evaluate the user's proposals critically — don't reflexively agree. If a suggested approach is weaker than an existing option (or wrong), say so with reasoning before implementing
- Ask before adding dependencies
- Scope changes to the specific task; follow existing patterns. When a change leaves code unused (imports, consts, props, fields, files), remove it in the same change — don't leave dead/orphaned code behind
- No unit tests — the project has no test harness. Don't add unit tests or a test framework, and don't put unit-testing steps in plans; verify by running the app (see Commands)
- Keep CLAUDE.md reflecting the **current** state of the project — but reserve it for architecture and big-picture pointers (subsystems, data flow, where things live). Do **not** add implementation minutiae (specific CSS classes, pixel constants, opacity math, individual handlers, scroll listeners); those belong in the code/comments and become stale fast. If an entry reads like a code comment, it's too detailed.
- Keep the skills in `.claude/skills/**` up to date as the application changes — when a change affects a subsystem documented by a skill, update that skill's `SKILL.md` in the same change so it stays accurate
- DB schema changes: edit `src/lib/db/schema.ts` only; run `npm run db:generate` to emit the drizzle migration — never hand-write files in `drizzle/` (see `db-migrations` skill)

## Commands

- `npm run dev` — dev server (turbopack); binds :5005 (`-p 5005`), auto-bumps to next free port if taken — read the bound port from the log
- `npm run build` — `db:push` (drizzle migrate + push) then `next build`; needs a working `db.sqlite`. `npm start` serves the build
- `npm run lint` (ESLint) / `npm run format:write` (Prettier, before commits) / `npx tsc --noEmit` (typecheck, no script). Pre-commit hook runs Prettier + ESLint on staged files
- `npm run db:generate` after editing `src/lib/db/schema.ts`; `npm run db:push` to apply
- No unit/test suite (`e2e/` is scaffolding only) — verify by running the app: `bash .claude/skills/run-yaawc/smoke.sh` (snapshots home + settings; grep the YAML, not the exit code), or drive it with the `playwright-cli` skill (use `--headed` for substantial UI changes). API smoke: `curl -s localhost:5005/api/config` must contain `chatModelProviders`
- Setup: if there's no `config.toml`, `cp sample.config.toml config.toml` (secrets/infra only) — **never overwrite an existing `config.toml`**; then `npm install`. Code execution / code widgets need Docker

## Data Fetching

Client-side server state uses **TanStack Query** (provider in `src/app/providers.tsx`). Don't `fetch` directly in components — use or add a hook in `src/lib/hooks/api/` (e.g. `useChats`, `useWorkspaces`). Hooks call the shared `apiFetch`/`ApiError` helper in `src/lib/api/client.ts` and use query keys from `qk` in `src/lib/api/keys.ts`. Mutations should invalidate the relevant keys.

## External Docs

- context7: `/quantizor/markdown-to-jsx`, `/context7/headlessui_com`, `/tailwindlabs/tailwindcss.com`, `/vercel/next.js`
- `docs-langchain` tool for LangChain/LangGraph

## Documentation Style

- Keep all documentation and README additions terse — prefer minimal facts over verbose prose. Match the brevity of surrounding sections and avoid bloated first drafts
