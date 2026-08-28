# Administration and settings

Settings are opened from the desktop sidebar or the mobile chat settings control, and are grouped by the area they change. Most non-secret settings are synchronized through the local database so another browser can receive them; appearance and a few device controls remain device-local.

## General settings

- **Appearance:** choose from built-in light and dark themes, or copy a built-in theme into the single editable Custom theme. Custom themes expose seven seed colors and a syntax style/variant for chat code blocks, workspace files, and editors. Theme selection is device-local; use Copy/Paste to move a theme between devices. See [Built-in themes](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/docs/THEMES.md).
- **Automation:** enable automatic related suggestions and automatic first-turn chat titles.
- **MCP Servers:** add and manage remote Model Context Protocol servers.
- **Memory:** enable retrieval and automatic detection, choose the memory-processing model, and manage stored memories. See [Personalization and memory](./personalization-and-memory.md).
- **Mapping:** enable the provider-gated mapping capability, acknowledge shipped public services when used, replace geocoder/places/routing/tile endpoints, choose driving/walking/cycling profiles, review capabilities and disclosed hosts, separately allow saved personalization for mapping, and clear the map cache. Mapping is disabled by default.
- **Persona Prompts:** create, edit, and delete reusable instructions for tone, formatting, and citation style. Built-in Web, Local, Chat, and Scholarly templates can be copied as a starting point.
- **Personalization:** save location and About Me context and control whether each is sent for a message.
- **Research Methodologies:** create one-at-a-time research playbooks for Web Search and Local Research. Built-in Comparative Analysis, Deep Dive/Literature Review, and Fact-Check/Verification templates can be copied.
- **Retention:** configure regular-chat, scheduled-run, and private-session deletion controls. See [Privacy and data](./privacy-and-data.md).
- **Skills:** create global or workspace-scoped instruction sets, enable or disable them, and mark them slash-only so the model cannot invoke them automatically.
- **Voice:** choose local Neural Kokoro speech or the device's System voice, a voice, playback speed, Read or Narrate mode, and an optional narration model. Auto-read is controlled from the composer.

## Model settings

- **Default Search:** choose the Chat model used for browser `?q=` searches when no override is needed.
- **Model Settings:** configure the embedding model and Custom OpenAI model name, base URL, and credential.
- **Model Presets:** save, apply, edit, duplicate, reorder, and delete named Chat/System/vision/context combinations. The active selection is shown when it matches a preset.
- **Agent Panel Presets:** save two-to-four executor models for the Agent Panel and apply them from Settings or the composer. A preset can become unavailable if a provider model disappears.
- **Model Visibility:** hide individual models or every model from a provider so they do not appear in selection controls. Hidden models remain configuration data and can make a saved preset unavailable.
- **Image Generation:** enable the OpenRouter image tool, refresh image-capable model choices, and set default aspect ratio and resolution. See [Models and providers](./models-and-providers.md).

Chat and System models are selected from the chat composer. The memory-processing model and embedding model are separate selections; changing the embedding model requires memory re-indexing and may require re-uploading incompatible file indexes.

## Search provider controls

**Settings → Search Providers** selects the regular primary provider, an optional private-chat primary, a fallback provider, search language, search region, and the SearXNG endpoint. The page shows whether web, image, video, and autocomplete capability comes from the primary, fallback, or neither. Search API keys are saved as encrypted credentials.

See [Models and providers](./models-and-providers.md) for the provider capability matrix and failure behavior.

## MCP server administration

Add a server name and URL, choose Auto, Streamable HTTP, or SSE transport, and configure no auth, bearer/API-key-style auth, OAuth client credentials, or interactive OAuth as supported by the server. Additional request headers can be stored for servers that need them. Secret values are write-only in the UI and encrypted at rest.

For each server you can enable or disable it, test the connection, authorize OAuth, refresh discovered tools, and set workspace scope. A server with no workspace scope is available to all chats; a scoped server can be made visible in unscoped chats with **visible in general chat**. Each discovered tool has its own enabled switch and either **Ask** or **Auto-run** approval policy.

MCP availability is based on the saved server state and the connection/discovery result. A disabled, unauthorised, errored, or out-of-scope server contributes no tools to a run. An MCP tool normally pauses for approval in an interactive chat; auto-run removes that pause, so use it only for trusted tools.

## Credential and configuration storage

`config.toml` is intentionally small at runtime. It contains the required encryption passphrase, optional base URL, and infrastructure settings such as Docker-backed code execution. Model/search credentials, provider URLs, model visibility, retention, image-generation settings, and model choices are managed in Settings and stored in the database or encrypted credential table.

The passphrase must be supplied before credentials can be saved. Keep it stable across restarts and back up it separately from the encrypted database. Detailed deployment options are in the [Configuration](./configuration.md) guide; backup and update procedures are in [Updating YAAWC](./updating.md).

## Voice availability

The System voice uses the browser's built-in speech engine and does not require a server model. Neural voice uses a local Kokoro model and may take longer on first use while its model is loaded or downloaded. Read mode speaks the response after removing UI-only markup. Narrate mode makes one additional call to the selected narration model, caches the rewritten narration per message/model, and falls back to Read when narration is unavailable.

The audio route accepts bounded message content. If neural synthesis or playback fails, the composer falls back to the browser voice. Browser voice availability and voice names depend on the device.

## Approvals, runs, and recovery

Interactive runs can pause for user questions, browser-location approval, code execution, workspace edits, skill edits, or MCP calls. History and the sidebar show running, awaiting-input, unread, errored, cancelled, and interrupted states. Reopening a chat restores pending approvals when the run is still resumable. A server restart can leave a run marked interrupted; submit a new turn after reviewing the message.

A workspace file or skill may change while an approval is open. YAAWC rejects the stale proposal and asks the agent or user to read the current content again. This protects newer edits but can require a second attempt.

## If a setting does not take effect

Refresh provider models after changing credentials or endpoints. Check whether a workspace model pin, hidden model, private-session rule, focus mode, or non-interactive run is overriding the expected option. A setting that is device-local, such as the active theme or chat width, does not propagate through the database settings sync. An unavailable optional service should show an explicit empty, disabled, or error state rather than making unrelated chats fail. Mapping configuration, provider, tile, and cache failures are isolated from ordinary chat/search; existing validated map prose remains available when an interactive map cannot load. Historical map snapshots do not refresh provider data when reopened.
