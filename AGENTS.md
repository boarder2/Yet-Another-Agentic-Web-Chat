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

Widgets are a **discriminated union** (`src/lib/types/widget.ts`): `LlmWidgetConfig` (`widgetType:'llm'` — prompt/provider/model, transformed by an LLM via `/api/dashboard/process-widget`) and `CodeWidgetConfig` (`widgetType:'code'` — user-authored JS run in the Docker sandbox via `/api/dashboard/process-code-widget`). Code widgets are only offered when **code execution is enabled** (`GET /api/config` → `codeExecution.enabled`). Sources are fetched server-side through the shared `src/lib/dashboard/sources.ts` (no SSRF guard — a deliberate, documented choice given the single-user/owner-approved trust model; internal/LAN/localhost sources are supported), injected to the sandbox over **stdin**; `codeWidgetRunner.ts` builds a nonce-framed fail-closed harness (`chart()` helper, `<Chart>` output), validates charts (size caps in `chartSpec.ts`), and **sanitizes** output (`sanitizeWidgetOutput.ts` — applied to all widget output at store + render; allows images incl. remote, blocks SVG + script/iframe/object/embed/base/link/style). A server-side semaphore bounds concurrent sandbox runs. **Rendering** is centralized in `WidgetContent.tsx` (used by `WidgetDisplay` and both preview panels, so previews match the saved widget exactly): it sanitizes, then renders output as raw HTML when it's an HTML fragment (`looksLikeHtml` requires a fragment-root tag at both ends so inline-tag-bearing markdown isn't misclassified — `WidgetHtmlContent` `dangerouslySetInnerHTML`s the **whole** fragment once, bypassing markdown-to-jsx, whose HTML-block parser **duplicates nested same-tag elements**, then swaps each `<Chart>` for an in-place marker span and **portals** a React `<ChartWidget>` into it so charts nested in styled containers keep their structure) or as markdown via `MarkdownRenderer` otherwise — so a single code widget may emit either form. Editors: `WidgetConfigModal` (LLM) and `CodeWidgetConfigModal` (code; CodeMirror via dynamic `ssr:false`), both using the shared `SourceListEditor`; `WidgetKindChooser` routes new widgets. The code editor embeds an **assistant** (`WidgetChatPanel` → `POST /api/dashboard/widget-builder`, see the `streaming-events` skill) that **proposes** incremental changes (`widget_proposal` → `WidgetProposalCard`) the user Accepts. **Theme-aware output:** the client resolves the live theme tokens to concrete colors (`resolveWidgetTheme()` in `src/lib/widgets/widgetTheme.ts`) and sends a `WidgetTheme` (`src/lib/types/widget.ts`) on every refresh/preview. LLM widgets get it appended to the prompt (`themePromptBlock`); code widgets receive it as the `theme` arg of `render({ sources, now, location, theme })` (injected via `codeWidgetRunner` stdin, defaulting to `DEFAULT_WIDGET_THEME` when absent). The `render` signature is documented once in `widgetTheme.ts` (`WIDGET_THEME_CONTRACT`) and reused by the seed template, the in-editor runtime help, and the builder assistant's system prompt, so a user can ask the assistant to "use the latest signature" / "make it theme-aware". Widgets persist client-side (`localStorage` → DB via settings layer); migration backfills `widgetType:'llm'` in both load and import paths. The dashboard toolbar toggles **View mode** (default — `WidgetDisplay` renders only widget content; grid drag/resize off) and **Edit mode** (header with title plus refresh/edit/convert/delete icon actions, and grid drag/resize — no sources list), via an `isEditMode` flag passed from `dashboard/page.tsx` to `WidgetDisplay`.

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
