# YAAWC capabilities

YAAWC is a self-hosted agentic web chat. It can research the web, work with local files, answer conversationally, create durable documents and widgets, and run repeatable prompts. The pages in this directory are the authoritative user-facing description of those capabilities, including prerequisites, limits, privacy behavior, availability, and common failure states.

## Find a capability

| Goal                                                                      | Guide                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Chat, web research, sources, focus modes, and conversation controls       | [Chat and research](./chat-and-research.md)                     |
| Attachments, workspaces, files, instructions, and workspace memory        | [Files and workspaces](./files-and-workspaces.md)               |
| Agent tools, deep research, skills, approvals, charts, and code           | [Agent capabilities](./agent-capabilities.md)                   |
| Artifacts, generated images, dashboards, and home widgets                 | [Artifacts and dashboards](./artifacts-and-dashboards.md)       |
| Parameterized workflows and scheduled tasks                               | [Automation](./automation.md)                                   |
| Personalization and long-term memory                                      | [Personalization and memory](./personalization-and-memory.md)   |
| Chat, system, embedding, image, and search providers                      | [Models and providers](./models-and-providers.md)               |
| Data storage, private sessions, retention, and external sharing           | [Privacy and data](./privacy-and-data.md)                       |
| Settings, MCP servers, themes, voice, visibility, and administration      | [Administration and settings](./administration-and-settings.md) |
| Deployment configuration, environment inputs, data paths, Docker, and TTS | [Configuration](./configuration.md)                             |
| Backups, release updates, verification, and rollback                      | [Updating YAAWC](./updating.md)                                 |

## Before you start

- Set `SECURITY.ENCRYPTION_PASSPHRASE` in `config.toml`. YAAWC needs it to encrypt credentials and blocks normal use until it is configured.
- Configure a chat model and a system model, or let the system model fall back to the chat model. Provider credentials are entered in Settings.
- Configure a search provider for web, image, video, or autocomplete features. Web Search requires a provider that can return web results.
- Select an embedding model before uploading chat documents or using semantic memory. A local Transformers embedding model is available when its runtime can load it; remote embedding providers require their credentials.
- Enable Docker-backed code execution separately if you need agent code or code widgets.
- Treat remote model providers, search services, source URLs, MCP servers, and dashboard sources as services that may receive the data needed for the requested operation.

## Contributor references

These technical references are maintained in the GitHub source tree:

- [Built-in themes](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/docs/THEMES.md)
- [Contributing](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/CONTRIBUTING.md)

Availability depends on the selected focus mode, configured models and providers, workspace or private-session state, and the local services an operator has enabled. When a prerequisite is missing, the relevant guide describes what is unavailable and how to recover.
