# YAAWC

Self-hosted agentic AI search: query → API route → `SimplifiedAgent` (LangGraph React agent, `src/lib/search/simplifiedAgent.ts`) researches with tools → streams a cited answer. Two models per turn: **Chat** (reasoning, final answer) and **System** (tools, internal chains).

Stack: Next.js App Router + React 19 + Tailwind 4, TanStack Query, LangChain/LangGraph, SQLite + Drizzle, SearXNG. `config.toml` holds infra config + the required encryption passphrase only; everything else is DB-backed.

## Commands

- `npm run dev` — dev server on :5005 (auto-bumps if taken — read the bound port from the log)
- `DATA_DIR=/path/to/data npm run build` — db:push then next build; `DATA_DIR=/path/to/data npm start` serves it. Keep one explicit `DATA_DIR` across Drizzle, build, dev, and runtime commands because the runtime and Drizzle defaults differ when it is unset.
- `npm run lint` / `npm run format:write` / `npx tsc --noEmit`
- `npm run test` — all tests (the CI gate); `npm run test:unit` — vitest, isolated behavior
- `npm run test:e2e` — Playwright suite in `e2e/` (`--project=chromium|api|smoke|serial`); mocked LLM, isolated test DB. See `e2e/CLAUDE.md`; coverage matrix in `e2e/COVERAGE.md`
- `npm run db:generate` after editing `src/lib/db/schema.ts`; `npm run db:push` to apply — never hand-write files in `drizzle/`
- Setup: `cp sample.config.toml config.toml` (**never overwrite an existing `config.toml`**), then `npm install`

## Architecture

Subsystem detail lives in the `.agents/skills/yaawc-*` skills — read the relevant one before working in an area.

- **Stream events** (`src/lib/streaming/`): the one agent↔UI seam. Producers emit typed `AgentEmitEvent`s; `runHost` synthesizes the NDJSON `StreamEvent`s; the client folds each through one pure reducer shared by live and reconnect paths; `ChatWindow` performs the returned `StreamEffect`s.
- **Widget envelopes** (`src/lib/widgets/envelope.ts`): in-message widgets (tool calls, subagents, panel columns, artifact cards) are ` ```yaawc:<kind> ` fences with a single-line JSON payload — writer-appended only; model-streamed `yaawc:` fences are neutralized, so spoofing is structurally impossible. `MarkdownRenderer` dispatches them to typed components.
- **Token tracking** (`src/lib/tokens/tracker.ts`): one `TokenTracker` per turn, threaded to the agent, tools, and child runs; emits per-(provider, model) stats.
- **Focus modes**: Web Search (all tools), Local Research (file search + citations), Chat (conversational).
- **Agent panel** (`src/lib/search/panel/`): fans one prompt across 2–4 executor models in parallel; the turn's chat model synthesizes one answer.
- **Workspace files** (`src/lib/workspaces/`): content-addressed blobs; every write is a compare-and-swap against the sha it replaces — losers get `ConflictError` (API 409).
- **Artifacts** (`src/lib/artifacts/`; tools in `src/lib/tools/agents/artifactTools.ts`): agent-authored self-contained HTML pages beside the chat; every write is an immutable versioned snapshot anchored to its message. Workspace-owned when the chat is in a workspace (shared across its chats), chat-owned otherwise. Served as HTML only via `/api/artifacts/[id]/raw` with a no-network, opaque-origin CSP on the response.
- **Workflows & schedules** (`src/lib/workflows/`, `src/lib/scheduledTasks/`): parameterized prompts (`{{name}}` templating) plus cron schedules that run them headlessly; UI in `src/app/automations/`.
- **MCP servers** (`src/lib/mcp/`): remote servers whose tools are injected into every tool-running focus mode; API under `/api/mcp/*`.
- **Dashboard widgets** (`src/lib/types/widget.ts`): two kinds — LLM-transformed and user-JS in a Docker sandbox; rendered on `/dashboard` and the home page.
- **TTS** (`src/lib/tts/`): local Kokoro speech synthesis for messages — plain read or LLM-rewritten narration (cached per message); served via `/api/tts(/stream)`.
- **Theming** (`src/lib/theme/`): a theme is seven seed colors written onto `:root`; every other token derives in `globals.css` via `color-mix`. Device-local, restored before first paint.
- **Settings** (`src/lib/settings/`): non-secret settings sync localStorage ⇄ DB (DB is source of truth); credentials live in a dedicated table, encrypted at rest (`src/lib/credentials.ts`).

## Conventions

**Write like a lead developer. Less is more.** Smallest correct change; DRY — extract and reuse instead of copy-paste; match the idioms of the file you're in. Comments are rare and explain a non-obvious _why_, never restate code. Remove code a change orphans (imports, props, files) in the same change.

- TypeScript strict, `@/*` → `src/*`; npm for all commands
- UI: reuse the primitives in `src/components/ui/` (`Button`, `Modal`, `Select`, `Input`/`Field`, …) — never hand-roll a dialog or scrim. See the `yaawc-design-system` skill
- Data fetching: TanStack Query hooks in `src/lib/hooks/api/` via `apiFetch` (`src/lib/api/client.ts`) and keys from `qk` (`src/lib/api/keys.ts`) — no raw `fetch` in components; mutations invalidate their keys
- DB changes: edit `src/lib/db/schema.ts` only, then `npm run db:generate`
- Tests use the lowest practical level: prefer fast Vitest unit tests for pure or isolated behavior; use Playwright for UI workflows and full application boundaries. Avoid duplicating unit coverage in e2e unless the e2e test verifies an additional integration boundary. E2e tests never call a real LLM (env-gated test provider — see `e2e/CLAUDE.md`)
- Ask before adding dependencies
- Terse, factual responses; clarify via `AskUserQuestion`, never inline in prose; evaluate the user's proposals critically — say so with reasoning when one is weak
- Keep this file and the `yaawc-*` skills accurate when a change touches what they document — big-picture only, no implementation minutiae. Docs/README additions equally terse
- For every user-visible change, review the relevant `docs/capabilities/` page and update it in the same change when behavior, prerequisites, limits, privacy, availability, or failure states change. `docs/capabilities/` is authoritative; its pages must describe current behavior only and must not contain history or roadmap prose.

## Pointers

- Domain glossary: `CONTEXT.md` — use its terms, not its listed "avoid" synonyms. ADRs in `docs/adr/` (lazily created); see `docs/agents/domain.md`
- Issues: GitHub Issues on `boarder2/Yet-Another-Agentic-Web-Chat` via `gh`; labels per `docs/agents/triage-labels.md`
- External docs: context7 (`/vercel/next.js`, `/tailwindlabs/tailwindcss.com`, `/quantizor/markdown-to-jsx`, `/context7/headlessui_com`); `docs-langchain` tool for LangChain/LangGraph
