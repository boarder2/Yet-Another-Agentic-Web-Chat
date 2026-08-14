# Yet Another Agentic Web Chat (YAAWC)

YAAWC is an open-source, self-hosted agentic web chat. A LangGraph agent can search the web, read sources, work with local files, and stream a cited answer while you choose the Chat and System models that power the turn. It uses your configured search and model providers rather than a hosted YAAWC service.

## Capabilities at a glance

The user-facing capability corpus is the source of truth for current behavior, prerequisites, limits, privacy, and failure states:

| Area                                                                  | Guide                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Chat, focus modes, web research, citations, and conversation controls | [Chat and research](docs/capabilities/chat-and-research.md)                     |
| Attachments, workspaces, files, instructions, and workspace memory    | [Files and workspaces](docs/capabilities/files-and-workspaces.md)               |
| Agent tools, deep research, skills, approvals, charts, and code       | [Agent capabilities](docs/capabilities/agent-capabilities.md)                   |
| Artifacts, generated images, dashboards, and home widgets             | [Artifacts and dashboards](docs/capabilities/artifacts-and-dashboards.md)       |
| Workflows and scheduled tasks                                         | [Automation](docs/capabilities/automation.md)                                   |
| Personalization and long-term memory                                  | [Personalization and memory](docs/capabilities/personalization-and-memory.md)   |
| Chat, System, embedding, image, and search providers                  | [Models and providers](docs/capabilities/models-and-providers.md)               |
| Storage, private sessions, retention, and external data sharing       | [Privacy and data](docs/capabilities/privacy-and-data.md)                       |
| Settings, MCP, themes, voice, model visibility, and administration    | [Administration and settings](docs/capabilities/administration-and-settings.md) |

Developer architecture is documented separately in [docs/architecture/README.md](docs/architecture/README.md).

## Quick start with Docker

1. Install Docker and Docker Compose.
2. Clone the repository:

   ```bash
   git clone https://github.com/boarder2/Yet-Another-Agentic-Web-Chat.git
   cd Yet-Another-Agentic-Web-Chat
   ```

3. If you do not already have a `config.toml`, create one from the sample and set `SECURITY.ENCRYPTION_PASSPHRASE`:

   ```bash
   cp sample.config.toml config.toml
   ```

4. Start YAAWC and its SearXNG service:

   ```bash
   docker compose up -d
   ```

5. Open [http://localhost:5005](http://localhost:5005) and configure model and search-provider credentials in Settings.

See the [configuration guide](docs/installation/configuration.md) for infrastructure settings and the [update guide](docs/installation/UPDATING.md) for deployment maintenance.

## Manual setup

Install and configure SearXNG with JSON output enabled, then create `config.toml` from `sample.config.toml`, set the encryption passphrase, and run:

```bash
npm install
npm run build
npm start
```

For local development, use `npm run dev`. `config.toml` contains the encryption passphrase and infrastructure settings. Model and search credentials, provider endpoints, and most feature settings are managed in the app; code-execution Docker settings remain in `config.toml`.

## Development and contribution

Useful checks:

```bash
npm run lint
npx tsc --noEmit
npm run test
```

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. User-visible changes must review the relevant capability guide and update it when behavior, prerequisites, limits, privacy, availability, or failure states change.

## Acknowledgements

YAAWC builds on the work of [Perplexica](https://github.com/ItzCrazyKns/Perplexica), an open-source AI-powered search engine.

YAAWC is available under the [MIT License](LICENSE).
