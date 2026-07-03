# Settings

The Settings page is the central configuration hub for YAAWC. It is organized into collapsible sections, grouped into **General**, **AI Models**, **Search**, and **Security**.

**Route:** `/settings`

> **Persistence note:** "in localStorage" below describes the synchronous local
> cache. Non-secret settings are also the durable, cross-device source of truth
> in the `app_settings` DB table, synced via `/api/settings` (see
> `src/lib/settings/persist.ts` + the `MIGRATED_SETTING_KEYS` allowlist).
> Exceptions that stay **localStorage-only**: `appTheme`, `userBg`, `userAccent`,
> `chatWidthWide`, `codeExecutionWarningAccepted`. **Secrets** (model/search
> provider API keys, MCP auth) never go through this path — they're encrypted
> at rest in a dedicated `credentials` DB table (AES-256-GCM, see
> `src/lib/credentials.ts` / `src/lib/encryption.ts`), keyed from the
> passphrase in `config.toml`. **Ambient settings** (memory toggles,
> personalization location/profile and their send-enabled flags) are read
> **server-side** from `app_settings` by `/api/chat` and are no longer sent in
> the request body; per-request composer choices (model selection, selected
> prompts, vision) remain request parameters.

---

## Navigation

- Accessed via the sidebar Settings icon (desktop) or the gear icon on the empty chat screen (mobile).
- A back arrow at the top links to `/` (Home).

---

## Loading State

While configuration loads from `/api/config`, a full-page spinner is displayed.

---

## General

### Automatic Search

A single toggle switch.

- **On**: The AI automatically generates follow-up suggestion queries after each response.
- **Off**: Users must manually click "Load suggestions" to see related queries.
- **Persistence**: `autoSuggestions` in localStorage. Also synced to the DB.

### MCP Servers

CRUD for remote MCP servers (see `mcp-integration` skill).

- Add/edit a server's name, URL, transport (auto/Streamable HTTP/SSE), and auth (none, bearer/API key, OAuth client credentials, or interactive OAuth). Secrets are write-only — existing tokens are never re-displayed.
- **Test** probes the connection; **Authorize** starts the interactive OAuth flow; **Refresh tools** re-runs discovery.
- Expand a server's **Tools** panel to enable/disable individual tools and toggle auto-run vs. ask-before-running per tool.

### Memory

Cross-conversation memory: enable/disable, toggle retrieval (inject relevant memories into chats) and automatic detection (LLM-analyzes conversations for facts worth remembering), pick the memory-processing model, and browse/search/add/edit/delete stored memories (with re-index and delete-all actions).

- **Persistence**: `memoryEnabled`, `memoryRetrievalEnabled`, `memoryAutoDetectionEnabled` in localStorage (DB-synced). Memory-processing model under its own `memoryModelProvider`/`memoryModel` keys — independent of the chat picker's `systemModelProvider`/`systemModel`.

### Persona Prompts

A CRUD interface for custom persona prompts that guide the AI's behavior and formatting.

- Each prompt is a card (name + truncated content) with edit/delete.
- **Add**: inline form (name + content), `POST /api/system-prompts`.
- **Copy Template** dropdown offers pre-built formatting templates (Web, Local, Chat, Scholarly) to paste into a prompt.

### Personalization

Two fields for providing personal context to the AI:

| Field        | Type       | Description                                                           |
| ------------ | ---------- | --------------------------------------------------------------------- |
| **Location** | Text input | User's location (city, country, etc.) sent with messages when enabled |
| **About Me** | Textarea   | Personal profile/preferences sent with messages when enabled          |

- Changes save immediately on input and dispatch a `personalization-update` custom event for real-time sync with the chat input's PersonalizationPicker.
- **Persistence**: `personalization.location`, `personalization.about` in localStorage.

### Research Methodologies

Same CRUD pattern as Persona Prompts, but for methodology prompts (`type: 'methodology'`) used by research-oriented focus modes. Includes a template picker over `builtinMethodologyTemplates`.

### Retention

Automatic purge policy for chats and scheduled task runs (pinned chats are never purged), plus private-session duration.

- **Regular Chats** / **Scheduled Task Runs**: mode (`days` / `count` / `disabled`) + a numeric value.
- **Private Session Duration**: predefined options (5 min – 7 days) or a custom value in minutes.
- **Persistence**: `retentionChatsMode/Value`, `retentionScheduledRunsMode/Value`, `privateSessionDurationMinutes` in localStorage (DB-synced).

### Skills

CRUD for user-defined agent skills (on-demand instructions the agent can load), global or workspace-scoped, with a toggle for model auto-invocation vs. slash-command-only.

### Voice

Read-aloud configuration: engine (local neural model vs. browser built-in), voice, playback speed, and narration mode (faithful read vs. LLM-generated descriptions of tables/charts, with its own model picker). Includes an inline preview player.

- **Persistence**: `ttsVoice`, `ttsEngine`, `ttsSpeed`, `ttsNarrationMode`, `ttsNarrationProvider`, `ttsNarrationModel` in localStorage (DB-synced).

---

## AI Models

### Default Search

Override the model used for direct search queries (e.g., OpenSearch/address bar integration).

- **Model picker**: provider + model.
- **Reset button**: clears the override, reverting to the default chat model.
- **Persistence**: `searchChatModelProvider`, `searchChatModel` in localStorage.

### Model Settings

Configuration for provider connections and the embedding model. (Chat and system models are chosen from the chat input's model picker, not here; the memory-processing model lives in the Memory section.)

- **Custom OpenAI**: model name, API key, base URL — for OpenAI-compatible endpoints (LM Studio, vLLM, etc.).
- **Embedding Model**: provider + model dropdowns. Used system-wide for indexing/querying (file upload, file search, memories); resolved server-side so requests never carry it. Changing it triggers a memory re-index.
- **Persistence**: `customOpenaiModelName`, `customOpenaiApiUrl`, `embeddingModelProvider`, `embeddingModel` in localStorage (DB-synced); `customOpenaiApiKey` is an encrypted credential.

### Model Presets

Save named combinations of chat model, system model, vision capability, and context window (up to a fixed max). Apply, edit, duplicate, reorder, or delete presets; "Current" shows which preset (if any) matches the live selection. Presets are also selectable from the chat input.

- **Persistence**: presets array under a single localStorage key (DB-synced); applying one writes the chat picker's own selection keys.

### Agent Panel Presets

Save named Agent Panel configurations — a set of 2–4 executor models — for the composer's panel mode. Apply, edit, duplicate, reorder, or delete.

- **Persistence**: presets array under a single localStorage key (DB-synced).

### Model Visibility

Control which models appear in selection dropdowns throughout the application.

- **Expandable provider sections**, per-model toggles, and per-provider "Show All"/"Hide All".
- **Persistence**: `hiddenModels` in localStorage (DB-synced).

### Image Generation

Enable/disable agent image generation (via OpenRouter) and configure its default model, aspect ratio, and resolution.

- **Persistence**: `imageGenerationEnabled`, `imageGenerationModel`, `imageGenerationAspectRatio`, `imageGenerationImageSize` in localStorage (DB-synced). Requires an OpenRouter API key (Settings → API Keys).

---

## Search

### Search Providers

Choose which search provider (SearXNG, Brave Search, Brave LLM Context, Mojeek) powers regular vs. private chats, plus a fallback provider, search language, and region. A capability table shows which provider serves web/image/video/autocomplete search for each mode. Provider API keys/URLs are configured here too.

- **Persistence**: `searchProvider`, `searchPrivateProvider`, `searchFallbackProvider`, `searchLanguage`, `searchRegion`, `searxngApiUrl` in localStorage (DB-synced, unencrypted). `braveSearchApiKey`, `braveLLMApiKey`, `mojeekApiKey` are encrypted credentials.

---

## Security

### API Keys

Input fields for model-provider connections. Each field saves on blur.

| Field                  | Type     | Description                           |
| ---------------------- | -------- | ------------------------------------- |
| **OpenAI API Key**     | Password | API key for OpenAI models             |
| **GROQ API Key**       | Password | API key for Groq models               |
| **OpenRouter API Key** | Password | API key for OpenRouter                |
| **Anthropic API Key**  | Password | API key for Anthropic (Claude) models |
| **Gemini API Key**     | Password | API key for Google Gemini models      |
| **Deepseek API Key**   | Password | API key for Deepseek models           |
| **AI/ML API Key**      | Password | API key for AI/ML platform            |
| **LM Studio API URL**  | Text     | Base URL for LM Studio instance       |

- API keys are encrypted credentials (`src/lib/credentials.ts`); the `LM Studio API URL` field is an unencrypted DB-backed setting (`lmStudioApiUrl` in localStorage, DB-synced).
- After saving an API key or URL, the page re-fetches `/api/config` to update available model lists.
- A spinning indicator appears briefly beside the field during save.

---

## Collapsible Sections

Each settings section is wrapped in a collapsible component:

- **Title**: Clickable to expand/collapse.
- **Info tooltip** (optional): Some sections have an info icon that opens a click-to-toggle explanation popup.
- Sections are collapsed by default and expand when clicked.

---

## Save Behavior

- **Encrypted credentials** (API keys): save on blur via `POST /api/config`.
- **Non-secret DB-backed fields** (endpoint URLs, model selections, toggles, presets, etc.): save to localStorage and sync to `app_settings`.
- **Device-local UI prefs** (theme, accent, bg, chat width): localStorage only.
- **Persona prompts / methodologies**: save via dedicated API endpoints (`POST`, `PUT`, `DELETE /api/system-prompts`).
- **Memories**: save via dedicated API endpoints (`/api/memories/*`).
- **MCP servers**: save via dedicated API endpoints (`/api/mcp/servers/*`).
- **Saving feedback**: a spinning indicator appears next to the field being saved.
