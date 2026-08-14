# Privacy and data

YAAWC is self-hosted: the operator controls the application process, database, data directory, and configured services. Self-hosting does not prevent data from leaving the deployment when a feature uses a remote model, search provider, source URL, image service, or MCP server.

## What stays in the deployment

The local YAAWC database and data directory hold conversation messages and run state, settings, encrypted credentials, memories, workflow and schedule definitions, workspace metadata and files, artifacts, generated images, and relevant caches. Uploaded chat files and generated images are stored as local data files referenced by database records.

Non-secret settings are synchronized through the database-backed settings store. Provider and search API keys are kept in a dedicated encrypted credential store using AES-256-GCM. The encryption key is derived from the operator-supplied passphrase in `config.toml` or `ENCRYPTION_PASSPHRASE`; the passphrase itself is not stored in the database or returned to the client.

## What can be sent to external services

Depending on the selected feature and provider, YAAWC can send:

- User prompts, conversation context, selected persona instructions, and requested outputs to the configured Chat or System model endpoint.
- Web queries to the selected search provider and page, PDF, image, or YouTube URLs to retrieve their content.
- Attached or workspace file content to the model or embedding provider needed for indexing, search, analysis, or answering.
- Image data to a vision-capable model for analysis, or image prompts to the configured image-generation provider.
- Dashboard source URLs to the server-side fetcher and resulting source content to the selected AI widget model or local code widget sandbox.
- MCP tool arguments and credentials to the configured MCP server when its tools are used.

Personalization context is instructed to remain out of retrieval tool calls, web requests, and citations, but it can be included in the selected model's internal context when its send controls are enabled. Review provider policies and endpoint ownership before enabling a feature.

## Private sessions

Start a private session from the empty-chat private toggle or with `?private=1`. Private sessions:

- Do not use saved personalization or memory and do not create automatic memories.
- Exclude private chats from agent chat-history search and message lookup.
- Withhold durable artifact tools.
- Can use a separate primary search provider selected in Settings.
- Are deleted automatically after the configured duration. The default is 24 hours; presets range from 5 minutes to 7 days, and a custom duration is allowed.

Private data is still stored locally while the session exists so the active conversation can run. Retention cleanup skips an active private run and removes the chat and its chat-scoped generated data after expiry.

## Retention and deletion

**Settings → Retention** controls regular chats and scheduled-run chats independently. Each policy can keep data for a number of days, keep a number of most-recent chats, or be disabled. Pinned chats are excluded from regular retention deletion. Scheduled tasks can override the global scheduled-run policy.

Deleting a chat removes its messages and chat-scoped artifacts and generated images. Workspace-owned artifacts and generated images survive deletion of their originating chat because the workspace owns them. Deleting a workspace removes its files and workspace-owned artifacts/images, but detaches its chats and memories into the unscoped area instead of deleting those records.

Retention cleanup also removes expired private sessions and eligible scheduled or regular chats. Keep backups of the deployment data directory if you need recovery; YAAWC does not provide a separate cloud backup.

## Sandboxed output

Agent-authored artifacts are served with an opaque, no-network sandbox policy. Code execution and code widgets run in Docker without network access or host filesystem access. These controls limit what the generated document or code can do; they do not stop the model or the server-side source fetcher from contacting configured external services before the sandbox step.

Dashboard and widget source URLs are authored by the operator and fetched by the server. Review imported widget JSON, source URLs, and assistant-proposed code before accepting them.

## Availability and failure states

A missing encryption passphrase blocks credential-backed use. If the passphrase changes, existing encrypted credentials cannot be decrypted and must be entered again. A provider or source outage can prevent a feature from completing while leaving local chats and settings available. Memory, embeddings, code execution, image generation, MCP, and search each have independent prerequisites; a failure in one does not imply that all YAAWC data or features are unavailable.

For configuration controls, see [Administration and settings](./administration-and-settings.md). For provider-specific requirements, see [Models and providers](./models-and-providers.md).
