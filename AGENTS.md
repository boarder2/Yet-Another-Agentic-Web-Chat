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

Discriminated union (`src/lib/types/widget.ts`): `LlmWidgetConfig` (LLM-transformed via `/api/dashboard/process-widget`) and `CodeWidgetConfig` (user JS in Docker sandbox via `/api/dashboard/process-code-widget`, gated on code execution being enabled). Sources fetched server-side (`src/lib/dashboard/sources.ts`; no SSRF guard by design — single-user trust model). Output sanitized (`sanitizeWidgetOutput.ts`: allows images, blocks SVG/script/iframe) and rendered by `WidgetContent.tsx` (HTML, markdown, or portaled `<ChartWidget>`). Code widgets expose `render({ sources, now, location, theme })` — contract in `widgetTheme.ts`. Code editor has a built-in builder assistant (`POST /api/dashboard/widget-builder`). Widgets persist localStorage → DB.

**Two surfaces.** Widgets render on the `/dashboard` page **and** the home/new-chat page (`EmptyChat`). Independent per-widget placement flags (`showOnHome`, `showOnDashboard`; `showOnDashboard === undefined` ⇒ shown, for back-compat) and a separate layout per surface (`layout` = dashboard, `homeLayout` = home). Both are full editors sharing `useWidgetBoard(surface)` (`src/lib/hooks/useWidgetBoard.ts`, wraps surface-aware `useDashboard`) and the `WidgetModals` trio. Placement is toggled from `WidgetDisplay`'s edit-mode controls (`setWidgetPlacement`). Home renders via `HomeWidgetBoard`; the new-chat input is vertically centered in the viewport (a `50vh` spacer + `-translate-y-1/2` on the input, so it stays centered regardless of widget count) with an "Add widget" affordance, and the widget board flows immediately below it. An edit-mode "peek" toggle (`HomeWidgetToolbar` → `handleToggleHomePeek`, persisted as `settings.homeWidgetsPeek`) pushes the board below the fold so only its top edge shows (`HOME_PEEK_MIN_HEIGHT`; reveals less at `lg`+, more on mobile where the bottom nav covers the sliver); it centers the input above the fold instead of using the spacer/translate centering, and is suppressed while editing. Home widgets are gated to the true home only (not workspace new-chat).

## Settings

`config.toml` holds only secrets and infra (API keys, DB, search, similarity) — there is **no `[SELECTED_MODELS]` section**; all model selection is DB-backed or request-supplied. Model selection uses one controlled, persistence-free component, `ModelPicker` (`src/components/models/`). Chat/system/vision/context-window are set from the chat input's `ModelConfigurator` dialog (chat and system independent — pair them via **Model Presets**, `modelPresets`). DB-backed model keys (`app_settings` table, read server-side): `embeddingModel*` via `getEmbeddingModelSelection()` (Settings → Model Settings), `memoryModel*` via `getMemoryModelSelection()` (Settings → Memory; independent of `systemModel`). Each falls back to the first available model when unset; `resolveModels` falls back to the chat model when a request omits `systemModel`.

**Settings persistence:** non-secret settings are the durable, cross-device source of truth in `app_settings`; `localStorage` is a synchronous cache. `src/lib/settings/persist.ts` patches `Storage.prototype` to sync allowlisted keys (`MIGRATED_SETTING_KEYS`) to `/api/settings`, hydrating from DB on load and re-pulling on focus/navigation (`SettingsHydrator`, `resyncSettingsFromDb`). Call sites are unchanged — keep using `useLocalStorage*`. **Excluded:** secrets stay in `config.toml`; device-local UI prefs (`appTheme`, `userBg`, `userAccent`, `chatWidthWide`, `codeExecutionWarningAccepted`) stay in localStorage only.

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
