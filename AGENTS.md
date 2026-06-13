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

`config.toml` holds API keys, DB, search, similarity. **All model selection uses one controlled component, `ModelPicker` (`src/components/models/`)** — chat/system/vision/context-window fields are optional per caller, and it owns no persistence (caller persists `onChange`). The chat model, system model, vision, and context window are configured from the **chat input's `ModelConfigurator` dialog** (localStorage `SELECTION_KEYS`); chat and system models are selected independently (there is no link/mirror toggle — use Model Presets for paired combos). Settings → **Model Settings** is now minimal: the embedding model and custom_openai credentials only — no chat/context/system controls. The **embedding model** is **DB-backed** under `embeddingModelProvider`/`embeddingModel` (the `app_settings` table, synced via the settings persistence layer — see below); server code reads it via `getEmbeddingModelSelection()` (`src/lib/settings/server.ts`), falling back to the first available embedding model when unset (`resolveModels` and `api/memories/*`). The server-side **memory-processing model** is configured in **Settings → Memory** ("Memory Processing Model") and is **DB-backed** under its own keys `memoryModelProvider`/`memoryModel`. It is fully **independent** of the chat picker's `systemModel`/`systemModelProvider` keys, so applying a chat model preset never touches it (and vice versa). Server code reads it via `getMemoryModelSelection()`; when unset, callers fall back to the first available chat model. It is used by memory extraction/dedup/classify/reindex (`api/memories/*`). `resolveModels` falls back to the **chat model** (not config.toml) when a request omits `systemModel` (interactive chats and scheduled tasks always supply their own `systemModel`). There is **no `[SELECTED_MODELS]` section in config.toml** — all model selection is DB-backed or request-supplied; config.toml holds only secrets and infra. **Model Presets** (`modelPresets`) are named bundles of chat+system provider/model, vision, and context window — applied/saved from the chat dialog (`PresetBar`) and managed in Settings → Model Presets (full CRUD).

**Settings persistence:** non-secret settings (model selection, presets, memory toggles, personalization, TTS prefs, dashboard config) are the durable, cross-device source of truth in the `app_settings` DB table; `localStorage` is a synchronous cache. `src/lib/settings/persist.ts` patches `Storage.prototype` (not the instance — instance assignment is dropped on the exotic Storage object) to sync allowlisted keys (`MIGRATED_SETTING_KEYS` in `src/lib/settings/keys.ts`) to `/api/settings` (`useSettings`/`useUpdateSettings`, `qk.settings`). On load it hydrates from the DB (first-run backfills local→DB) and re-pulls on tab focus/visibility and every route navigation (`SettingsHydrator` via `usePathname`) so a long-lived tab picks up other-device changes (`resyncSettingsFromDb`: throttled, single-flight, non-blocking, fires `settings-synced`). Writes are intercepted globally, so call sites are unchanged — keep using `useLocalStorage*`. **Excluded:** secrets (`openAIApiKey`/`openAIBaseURL`, provider keys) stay in `config.toml`; device-local UI prefs (`appTheme`, `userBg`, `userAccent`, `chatWidthWide`, `codeExecutionWarningAccepted`) stay in localStorage only.

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
