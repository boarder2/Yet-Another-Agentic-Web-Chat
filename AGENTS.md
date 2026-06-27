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

- Optional composer mode (orthogonal to focus mode; research modes only) that fans one prompt out across **2–4 executor models in parallel**, then has the **turn's chat model** synthesize a single answer from their results. Request shape: `body.panel` (`src/lib/types/panel.ts`) — executors only; no separate synthesizer model is configured.
- **Phase 1** — `PanelCoordinator` (`src/lib/search/panel/coordinator.ts`) runs each executor as a `SimplifiedAgent` on an isolated emitter with a non-prompting research toolset (`tools/panel/restrictedToolset.ts`), streaming `panel_executor_*` events; sources are merged/deduped by URL. **Phase 2** — the chat model runs as an ordinary agent (full tools, interrupts/resume unchanged), seeded with the merged citation set + a synthesis system turn (`prompts/panel/orchestrator.ts`). Wired in `api/chat/route.ts` inside the `isNew` block (resume never re-runs Phase 1).
- Columns render via the `<PanelColumns>` markup (`utils/panelMarkup.ts`, `MessageActions/PanelColumns.tsx`); stripped from history by `removeToolCallMarkup`. Composer UI: `MessageInputActions/PanelSelector.tsx` + device-local `panelSelection`. Presets (`lib/panel/panelPresets.ts`) store like model presets and have a settings section.
- Details + gotchas: `agent-panel` skill.

## MCP Servers

- Remote MCP servers connect via Settings → MCP Servers. Enabled servers' tools are injected into every tool-running focus mode. Per-tool config (`mcpServers.toolConfig`) lets users disable individual tools (never injected) and set each one to ask-every-time (default) or auto-run.
- Connection layer + auth (none/bearer/OAuth CC/interactive OAuth): `src/lib/mcp/`. API: `/api/mcp/servers/*`, `/api/mcp/oauth/callback`. Settings UI: `McpServersSection`.
- Details + gotchas: `mcp-integration` skill.

## Dashboard Widgets

- Two widget kinds (`src/lib/types/widget.ts`): LLM-transformed and user-JS (Docker sandbox, gated on code execution). Processed via `/api/dashboard/*`; sources fetched server-side (`src/lib/dashboard/sources.ts`), output sanitized (`sanitizeWidgetOutput.ts`) and rendered by `WidgetContent.tsx`.
- Rendered on two surfaces — `/dashboard` and the home page (`EmptyChat`) — with per-widget placement flags and a layout per surface. Both share `useWidgetBoard` (`src/lib/hooks/`), with board UI in `src/components/dashboard/`.
- Code-widget contract (`render({ sources, now, location, theme })`) lives in `widgetTheme.ts`; widgets persist localStorage → DB.
- Details + gotchas (sandbox stdin, no-SSRF decision, builder agent modes): `dashboard-widgets` skill.

## Settings

- `config.toml` holds **only** secrets/infra (API keys, DB, search). No model selection lives there — all of it is DB-backed (`app_settings`) or request-supplied.
- Non-secret settings sync localStorage ⇄ DB via `src/lib/settings/persist.ts` (the durable source of truth is the DB); secrets and device-local UI prefs are excluded. Keep using `useLocalStorage*` — call sites are unchanged.
- Model selection UI: `ModelPicker` (`src/components/models/`); embedding/memory model keys read server-side via helpers in `src/lib/settings/server.ts`.
- The settings UI is one controlled `SettingsPanel` (`src/app/settings/`) rendered on two surfaces: the `/settings` page (URL-driven section state, deep-link fallback) and a global modal. `SettingsModalProvider` (mounted in `layout.tsx`) exposes `useSettingsModal().openSettings(section?)`; entry points (sidebar/mobile gears, personalization/preset/persona pickers) open it instead of navigating.
- Adding a setting + the localStorage⇄DB sync internals: `settings-persistence` skill.

## Conventions

**Write like a lead developer. Less is more.** Favor the smallest correct change; one well-formed line over several. DRY — when logic/markup repeats, extract a function, component, or hook and reuse it rather than copy-paste. Reach for existing helpers, hooks, and patterns before inventing new ones; match the idioms of the file you're in. Prefer clear names and composition over cleverness. Comments are rare and earn their place — explain a non-obvious _why_, never restate the code; no banners, no narration, no commented-out code. Delete more than you add when you can.

- TypeScript strict, ES2017, `@/*` → `src/*`
- Package manager: **yarn** — use `yarn <script>` for all commands
- Prettier + ESLint (Next.js core web vitals); run `yarn format:write` before commits
- React functional components, one per file; camelCase funcs/vars, PascalCase components
- try/catch for async, structured error responses from API routes
- Terse, factual responses; ask when requirements are unclear
- Evaluate the user's proposals critically — don't reflexively agree. If a suggested approach is weaker than an existing option (or wrong), say so with reasoning before implementing
- Ask before adding dependencies
- Scope changes to the specific task; follow existing patterns. When a change leaves code unused (imports, consts, props, fields, files), remove it in the same change — don't leave dead/orphaned code behind
- No unit tests — the project has no test harness. Don't add unit tests or a test framework, and don't put unit-testing steps in plans; verify by running the app (see Commands)
- Keep AGENTS.md reflecting the **current** state of the project — but reserve it for architecture and big-picture pointers (subsystems, data flow, where things live). Do **not** add implementation minutiae (specific CSS classes, pixel constants, opacity math, individual handlers, scroll listeners); those belong in the code/comments and become stale fast. If an entry reads like a code comment, it's too detailed.
- Keep the skills in `.claude/skills/**` up to date as the application changes — when a change affects a subsystem documented by a skill (see Subsystem Skills), update that skill's `SKILL.md` in the same change so it stays accurate
- DB schema changes: edit `src/lib/db/schema.ts` only; run `yarn db:generate` to emit the drizzle migration — never hand-write files in `drizzle/` (see `db-migrations` skill)

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

Load on demand: `adding-features`, `api-endpoints`, `streaming-events`, `subagent-architecture`, `agent-panel`, `dashboard-widgets`, `mcp-integration`, `settings-persistence`, `db-migrations`, `image-attachments`, `frontend-architecture`, `design-system`, `prompt-system`, `test-automation`, `run-yaawc`, `playwright-cli`.

## External Docs

- context7: `/quantizor/markdown-to-jsx`, `/context7/headlessui_com`, `/tailwindlabs/tailwindcss.com`, `/vercel/next.js`
- `docs-langchain` tool for LangChain/LangGraph

## Documentation Style

- Keep all documentation and README additions terse — prefer minimal facts over verbose prose. Match the brevity of surrounding sections and avoid bloated first drafts
