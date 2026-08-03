# Project Overview

YAAWC (Yet Another Agentic Web Chat) is an open-source AI-powered search engine combining web search with LLM-based processing.

## Architecture

User query → API route → `SimplifiedAgent` (LangGraph React Agent) uses tools to research → streams response with cited sources.

- **Chat Model**: agent reasoning, final answer, streamed output
- **System Model**: tools and internal chains (URL summarization, query generation, task breakdown)

Stack: Next.js (App Router) + React 19 + Tailwind 4, TanStack Query (client data fetching), LangChain/LangGraph, SQLite+Drizzle, SearXNG, Xenova embeddings, optional LangFuse tracing. Config via `config.toml` (copy from `sample.config.toml`). LLM providers: OpenAI, Anthropic, Groq, Gemini, DeepSeek, LM Studio.

**Stream events** (`src/lib/streaming/`): the one seam between agent and UI. Producers emit typed, structured `AgentEmitEvent`s on a single emitter channel — no pre-rendered markup on the wire; `runHost` synthesizes the NDJSON wire `StreamEvent`s (adds the assistant `messageId`, `messageEnd`, replay/`gone`), buffered + replayed by `runHub`. The client parses each line and folds it through one pure reducer (`reducer.ts`, `reduce(state, event) → {state, effects}`) shared by the live-send and reconnect/attach paths — replay-gating is reducer state (`inReplay`); `ChatWindow` interprets the returned `StreamEffect`s. Unit-tested (`*.test.ts`), the exception to the e2e-only policy.

**Widget envelopes** (`src/lib/widgets/envelope.ts`): in-message widgets (tool calls, subagent executions, agent-panel columns) are serialized as a markdown code fence with a reserved ` ```yaawc:<kind> ` info string and a compact single-line JSON payload — an isomorphic codec (`appendWidget`/`updateWidget`/`findWidget`/`parseWidgetFence`/`stripWidgets`/`neutralizeSpoofedFences`) shared by the two writers (`reducer.ts`, `runHost.ts`) and the renderer (`MarkdownRenderer.tsx`'s `code` override dispatches known `yaawc:*` fences to typed widget components). Writers balance dangling fences before appending and neutralize any `yaawc:`-prefixed fence in model-streamed text, so widget spoofing is structurally impossible — all legitimate envelopes are writer-appended, never model tokens. Pre-migration messages render via a frozen, read-only legacy path for the old `<ToolCall>`/`<SubagentExecution>`/`<PanelColumns>` tag markup; nothing writes that format anymore. Unit-tested (`envelope.test.ts`), the same pure-module exception as the reducer.

**Token tracking**: a single `TokenTracker` (`src/lib/tokens/tracker.ts`) is created per user-visible turn and passed down to the agent, its tools (via `ToolContext.tracker`/`chatRecorder`/`systemRecorder`), and any child runs (panel executors, `deep_research` subagents, each tagged with a `scope`). It emits per-model `model_stats`/`stats`/`messageEnd.modelStats` snapshots (`ModelStatsV2`, one row per `(provider, model)`); `ModelStatsV1` is kept only to render historical messages.

## Focus Modes

- **Web Search**: default, all tools
- **Local Research**: file_search with citations
- **Chat**: conversational only
- **Firefox AI**: auto-detected, conversational only

## Agent Panel

Optional composer mode (research modes only) that fans one prompt across **2–4 executor models in parallel** (`PanelCoordinator`, `src/lib/search/panel/`), then has the **turn's chat model** synthesize one answer. Request shape: `body.panel` (`src/lib/types/panel.ts`); wired in `api/chat/route.ts`.

## Workspace Files

`src/lib/workspaces/`. Blobs live at `<DATA_DIR>/workspace-files/<workspaceId>/<fileId>/<sha256>` — content-addressed _within_ a file, never shared across files, so no blob needs a reference count. The row `UPDATE` is the commit point (stage blob → update row → unlink the old sha), so a crash leaks an orphan rather than dangling a row; orphans are reclaimed when the workspace is deleted. Every write is a compare-and-swap: `replaceFile` **requires** the sha it is replacing, so a concurrent write can never be silently lost — losers get a `ConflictError` (API `409`, agent `stale_state`, editor conflict banner). Legacy globally-deduplicated blobs are migrated on boot (`migrateBlobs.ts`).

## MCP Servers

Remote MCP servers (Settings → MCP Servers) whose tools are injected into every tool-running focus mode, with per-tool enable/auto-run config. Connection layer + auth in `src/lib/mcp/`; API under `/api/mcp/*`.

## Workflows & Schedules

Reusable, parameterized prompts. A **workflow** (`workflows` table) is a prompt whose inputs are declared in an optional leading `---` frontmatter block and referenced bare as `{{name}}` in the body (grammar + isomorphic parser/substitution in `src/lib/workflows/template.ts`, unit-tested) plus stored run config. A **schedule** (`schedules` table, child of a workflow) is a saved input fill-set + cron that fires the workflow headlessly. Manual run (`runManual.ts`) seeds a normal continuable chat stamped `chats.workflow_id`; scheduled run (`scheduledTasks/runner.ts`, `scheduler.ts`) persists a one-shot report stamped `chats.schedule_id`, marked finished-and-unviewed like any other run so it surfaces in History. Both share config/substitution via `resolveWorkflowRun.ts`. API under `/api/workflows/*` + `/api/schedules/*`; UI under `src/app/automations/` (Workflows + Scheduled Tasks tabs — the latter lists schedule definitions; their runs live in History), components in `src/components/workflows/`. Legacy `scheduled_tasks` rows migrate to workflow+schedule pairs on boot (`migrateScheduledTasks.ts`).

## Dashboard Widgets

Two widget kinds (`src/lib/types/widget.ts`): LLM-transformed and user-JS (Docker sandbox). Processed via `/api/dashboard/*`, rendered on `/dashboard` and the home page (shared `useWidgetBoard`, board UI in `src/components/dashboard/`).

## Theming

`src/lib/theme/`. A theme is seven seed colors (`bg`, `fg`, `surface`, `accent`, `danger`, `success`, `warning`) plus a mode; `themes.ts` holds the built-in catalogue (transcribed from canonical upstream specs — see `docs/THEMES.md`), and built-in and custom themes share one shape. Built-ins are immutable: the single custom slot is only written by an explicit, overwrite-confirmed action (copying a built-in into it, or pasting one), and editing is enabled only while the custom theme is active. A theme also names a `syntax` style for code rendering, bound to both renderers from one key (`syntax.ts` maps it to a Prism style for fences; `codemirror.ts` derives a CodeMirror theme from that same style for the editors; unset falls back by mode). Applying writes the seeds onto `:root`; every other token derives from them in `globals.css` via `color-mix`, mixing toward `--color-fg` so the derivations are mode-agnostic. Only the contrast-picked foregrounds are computed in TS (`derive.ts`, unit-tested). Theme state is device-local (not DB-synced); portability is copy/paste JSON. A render-blocking boot script in `layout.tsx` restores it before first paint. UI: Settings → Appearance.

## Settings

`config.toml` holds **only** infrastructure config (Docker/code-execution, `BASE_URL`/port) plus a required encryption passphrase (`SECURITY.ENCRYPTION_PASSPHRASE`, never auto-generated — the app blocks usage until it's set). Credentials — model/search provider API keys and MCP auth — are DB-backed and encrypted at rest (AES-256-GCM key derived from the passphrase, `src/lib/encryption.ts`), in a dedicated `credentials` table (`src/lib/credentials.ts`) separate from `app_settings`. Provider/search endpoint URLs (LM Studio, Custom OpenAI, SearXNG) are DB-backed too, via the ordinary settings-sync layer (unencrypted, non-secret). Everything else is DB-backed (`app_settings`) or request-supplied. Non-secret settings sync localStorage ⇄ DB (`src/lib/settings/`, DB is source of truth); model selection via `ModelPicker`; the settings UI is one `SettingsPanel` (`src/app/settings/`) shown as a page and a modal.

## Conventions

**Write like a lead developer. Less is more.** Favor the smallest correct change; one well-formed line over several. DRY — when logic/markup repeats, extract a function, component, or hook and reuse it rather than copy-paste. Reach for existing helpers, hooks, and patterns before inventing new ones; match the idioms of the file you're in. Prefer clear names and composition over cleverness. Comments are rare and earn their place — explain a non-obvious _why_, never restate the code; no banners, no narration, no commented-out code. Delete more than you add when you can.

- TypeScript strict, ES2017, `@/*` → `src/*`
- Package manager: **npm** — use `npm run <script>` for all commands
- Prettier + ESLint (Next.js core web vitals); run `npm run format:write` before commits
- React functional components, one per file; camelCase funcs/vars, PascalCase components
- try/catch for async, structured error responses from API routes
- Terse, factual responses; when clarification is needed, surface it via `AskUserQuestion` — never ask inline in prose
- Evaluate the user's proposals critically — don't reflexively agree. If a suggested approach is weaker than an existing option (or wrong), say so with reasoning before implementing
- Shared UI primitives live in `src/components/ui/` — `Button` (every labeled action button), `Modal` (every dialog; never hand-roll a scrim or use headlessui's `Dialog` directly), `card`, `AppSwitch`, `Select`, `Input`/`Textarea`/`Field` (every text form control and its label). See the `design-system` skill. Reuse them rather than hand-rolling markup
- Ask before adding dependencies
- Scope changes to the specific task; follow existing patterns. When a change leaves code unused (imports, consts, props, fields, files), remove it in the same change — don't leave dead/orphaned code behind
- Tests are **integration/e2e first** (Playwright, in `e2e/`). New functionality must ship with e2e/API specs covering it; tests assert _correct_ behavior (intended semantics), not whatever the code currently emits, and **never call a real LLM — always the env-gated `test` provider/model that returns predefined outputs** (see `e2e/CLAUDE.md`). Still verify by running the app too (see Commands). **Narrow exception:** pure, side-effect-free modules tested through their interface may have vitest unit tests (`src/**/*.test.ts`, `npm run test:unit`) — no DOM, no network, no LLM, no React rendering. The stream-event reducer/vocabulary (`src/lib/streaming/`) is the canonical case; don't reach for unit tests where an e2e/API spec fits. `src/lib/db/migrations.test.ts` is the one filesystem-touching exception — only replaying `drizzle/` onto an empty DB catches a migration that works locally but breaks new installs
- Keep CLAUDE.md reflecting the **current** state of the project — but reserve it for architecture and big-picture pointers (subsystems, data flow, where things live). Do **not** add implementation minutiae (specific CSS classes, pixel constants, opacity math, individual handlers, scroll listeners); those belong in the code/comments and become stale fast. If an entry reads like a code comment, it's too detailed.
- Keep the skills in `.claude/skills/**` up to date as the application changes — when a change affects a subsystem documented by a skill, update that skill's `SKILL.md` in the same change so it stays accurate
- DB schema changes: edit `src/lib/db/schema.ts` only; run `npm run db:generate` to emit the drizzle migration — never hand-write files in `drizzle/` (see `db-migrations` skill)

## Commands

- `npm run dev` — dev server (turbopack); binds :5005 (`-p 5005`), auto-bumps to next free port if taken — read the bound port from the log
- `npm run build` — `db:push` (drizzle migrate + push) then `next build`; needs a working `db.sqlite`. `npm start` serves the build
- `npm run lint` (ESLint) / `npm run format:write` (Prettier, before commits) / `npx tsc --noEmit` (typecheck, no script). Pre-commit hook runs Prettier + ESLint on staged files
- `npm run test` — runs _all_ tests (`test:unit` then `test:e2e`); this is the script CI gates on
- `npm run test:unit` — vitest, pure-module unit tests only (`src/**/*.test.ts`); the narrow exception to the e2e-first policy
- `npm run db:generate` after editing `src/lib/db/schema.ts`; `npm run db:push` to apply
- Playwright e2e/API suite in `e2e/` — `npm run test:e2e` (all), `npm run test:e2e:api`, `npm run test:e2e --project=chromium`; uses a mocked LLM provider (`YAAWC_TEST_MODE=true`) and isolated test DB. New functionality lands with specs (see `e2e/CLAUDE.md`, `e2e/api/CLAUDE.md`); `e2e/COVERAGE.md` tracks the route/page → spec matrix. Also spot-check by running the app: `bash .claude/skills/run-yaawc/smoke.sh` (snapshots home + settings; grep the YAML, not the exit code), or the `playwright-cli` skill (`--headed` for substantial UI changes). API smoke: `curl -s localhost:5005/api/config` must contain `chatModelProviders`
- Setup: if there's no `config.toml`, `cp sample.config.toml config.toml` (secrets/infra only) — **never overwrite an existing `config.toml`**; then `npm install`. Code execution / code widgets need Docker

## Data Fetching

Client-side server state uses **TanStack Query** (provider in `src/app/providers.tsx`). Don't `fetch` directly in components — use or add a hook in `src/lib/hooks/api/` (e.g. `useChats`, `useWorkspaces`). Hooks call the shared `apiFetch`/`ApiError` helper in `src/lib/api/client.ts` and use query keys from `qk` in `src/lib/api/keys.ts`. Mutations should invalidate the relevant keys.

## External Docs

- context7: `/quantizor/markdown-to-jsx`, `/context7/headlessui_com`, `/tailwindlabs/tailwindcss.com`, `/vercel/next.js`
- `docs-langchain` tool for LangChain/LangGraph

## Documentation Style

- Keep all documentation and README additions terse — prefer minimal facts over verbose prose. Match the brevity of surrounding sections and avoid bloated first drafts

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `boarder2/Yet-Another-Agentic-Web-Chat` (uses the `gh` CLI); external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) — no overrides. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
