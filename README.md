# Yet Another Agentic Web Chat (YAAWC) <!-- omit in toc -->

> Because the world definitely needed one more AI-powered search engine. You're welcome.

YAAWC (**Pronounced: "yawck"** — as in the sound you make when yet another AI search engine appears.) is an open-source, self-hosted, agentic AI search engine that actually reads web pages, manages research plans, spawns sub-agents for deep dives, and cites its sources — all while letting you pick from a buffet of LLM providers. It uses [SearXNG](https://github.com/searxng/searxng) under the hood so your queries stay private and the results stay fresh.

![preview](.assets/yaawc-screenshot.png?)

## Table of Contents <!-- omit in toc -->

- [Why Does This Exist?](#why-does-this-exist)
- [Features at a Glance](#features-at-a-glance)
- [Focus Modes](#focus-modes)
- [Agent Tools](#agent-tools)
- [Code Execution (Sandbox)](#code-execution-sandbox)
  - [Enabling Code Execution](#enabling-code-execution)
  - [Docker Deployment](#docker-deployment)
  - [Docker Socket Proxy (More Secure)](#docker-socket-proxy-more-secure)
  - [Manual (Non-Docker) Setup](#manual-non-docker-setup)
  - [Security Notes](#security-notes)
- [Deep Research (Sub-Agents)](#deep-research-sub-agents)
- [Dashboard Widgets](#dashboard-widgets)
- [Workspaces](#workspaces)
- [LLM Providers](#llm-providers)
  - [Chat Models](#chat-models)
  - [Embedding Models](#embedding-models)
- [Memory](#memory)
  - [How It Works](#how-it-works)
  - [Memory Categories](#memory-categories)
  - [Managing Memories](#managing-memories)
  - [Agent Memory Tools](#agent-memory-tools)
  - [Settings](#settings)
- [Private Sessions](#private-sessions)
  - [Starting a Private Session](#starting-a-private-session)
  - [What's Different](#whats-different)
  - [Configuration](#configuration)
- [Personalization \& Personas](#personalization--personas)
  - [Personalization](#personalization)
  - [Persona Prompts](#persona-prompts)
  - [Research Methodologies](#research-methodologies)
- [Scheduled Tasks](#scheduled-tasks)
- [Chat Retention](#chat-retention)
- [Conversation Compaction](#conversation-compaction)
- [Search Providers](#search-providers)
- [Installation](#installation)
  - [Docker (Recommended)](#docker-recommended)
  - [Manual Setup](#manual-setup)
  - [Ollama Connection Errors](#ollama-connection-errors)
- [Using as a Browser Search Engine](#using-as-a-browser-search-engine)
- [API](#api)
- [Network \& Reverse Proxy](#network--reverse-proxy)
- [Observability](#observability)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [A Note on AI Assistance](#a-note-on-ai-assistance)

## Why Does This Exist?

Most AI search tools either phone home with your data, cost a subscription, or give you yesterday's answers. YAAWC is fully open source, runs on your hardware, talks to whichever LLM you point it at, and searches the live web through a self-hosted SearXNG instance. It doesn't just retrieve links — it reads pages, extracts the good parts, ranks them by semantic similarity, and writes you a cited answer.

Want to know more about the architecture? See [docs/architecture/README.md](docs/architecture/README.md).

## Features at a Glance

| Category                    | Highlights                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agentic Search**          | LangGraph React agent with tool use, research planning, and multi-step reasoning                                                                                                      |
| **Deep Research**           | Spawns focused sub-agents that search → read → refine → search again                                                                                                                  |
| **13 Agent Tools**          | Web search, URL summarization, image search & analysis, YouTube transcripts, PDF loading, file search, deep research, sandboxed code execution, todo lists, memory (save/delete/list) |
| **10 LLM Providers**        | OpenAI, Anthropic, Groq, Ollama, Gemini, DeepSeek, LM Studio, OpenRouter, AI/ML API, Custom OpenAI                                                                                    |
| **6 Embedding Providers**   | OpenAI, Ollama, Gemini, Xenova Transformers (local), AI/ML API, LM Studio                                                                                                             |
| **Dashboard Widgets**       | AI-powered info widgets with auto-refresh, drag-and-drop layout, export/import                                                                                                        |
| **Personas**                | Custom system prompts with built-in templates (scholarly, conversational, etc.)                                                                                                       |
| **Research Methodologies**  | Per-message selectable research playbooks (Comparative Analysis, Literature Review, Fact-Check) with custom methodology authoring                                                     |
| **Scheduled Tasks**         | Cron-scheduled recurring agent runs with presets, per-task models/tools, run history, and unread-result badges                                                                        |
| **Chat Retention**          | Configurable auto-delete policies for old chats and scheduled-task run history, with pinning to exempt individual chats                                                               |
| **Search Providers**        | Pluggable backends — SearXNG, Brave Search, and Mojeek                                                                                                                                |
| **Personalization**         | Per-message location and profile context injection                                                                                                                                    |
| **Memory**                  | Long-term memory with semantic retrieval, automatic extraction, deduplication, and a full management UI                                                                               |
| **Private Sessions**        | Temporary conversations with auto-expiry — no personalization, no memory, no trace left behind                                                                                        |
| **Workspaces**              | Project-centric containers with per-workspace chats, files, source URLs, instructions, agent tools, and isolated memory                                                               |
| **Privacy**                 | Self-hosted SearXNG — no tracking, no data brokering, no "we updated our privacy policy" emails                                                                                       |
| **Browser Integration**     | OpenSearch XML, autocomplete, `?q=` URL queries with saved preferences                                                                                                                |
| **Streaming UI**            | Real-time tool calls, sub-agent progress, todo widgets, thinking/reasoning display                                                                                                    |
| **Image & Video Search**    | Dedicated search with gallery views and video embeds                                                                                                                                  |
| **File Research**           | Upload documents and research them with cited excerpts                                                                                                                                |
| **Respond Now**             | Interrupt ongoing retrieval and get an immediate answer from what's been gathered so far                                                                                              |
| **Interactive Questions**   | The agent can pause mid-research to ask clarifying questions with single/multi-select options or freeform input                                                                       |
| **Model Visibility**        | Admins can hide models from the UI to prevent accidental usage                                                                                                                        |
| **Dual Model Architecture** | Separate Chat and System models, linkable or independent                                                                                                                              |

## Focus Modes

Switch modes at any time during a conversation:

| Mode               | Description                                                | Tools       |
| ------------------ | ---------------------------------------------------------- | ----------- |
| **Web Search**     | Full agentic search across the internet                    | All 9 tools |
| **Chat**           | Creative conversation — no web searching, no tools         | None        |
| **Local Research** | Research uploaded files with semantic search and citations | File search |

Firefox AI prompts are auto-detected and handled conversationally.

## Agent Tools

The LangGraph agent has access to the following tools (individually toggleable per conversation):

| Tool                   | What It Does                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web Search**         | Queries SearXNG, retrieves top results, re-ranks by embedding similarity. Supports `site:` filters.                                                                          |
| **URL Summarization**  | Fetches a URL's content (via Readability/Cheerio/Playwright) and summarizes it or uses it directly.                                                                          |
| **Image Search**       | Searches for images via SearXNG (Bing Images, Google Images).                                                                                                                |
| **Image Analysis**     | Fetches an image and analyzes it using a vision-capable LLM (PNG, JPEG, GIF, WebP up to 10 MB).                                                                              |
| **YouTube Transcript** | Retrieves the full transcript from a YouTube video.                                                                                                                          |
| **PDF Loader**         | Extracts and returns content from a PDF URL.                                                                                                                                 |
| **File Search**        | Semantic similarity search across uploaded documents with configurable threshold.                                                                                            |
| **Deep Research**      | Spawns a focused sub-agent for comprehensive multi-source investigation (see below).                                                                                         |
| **Code Execution**     | Runs user-approved JavaScript in a sandboxed Docker container (see below).                                                                                                   |
| **Ask User**           | Pauses the agent to ask the user a clarifying question — supports single/multi-select options and optional freeform input; shows queue position and has a 15-minute timeout. |
| **Todo List**          | Manages a visible research plan (up to 10 tasks) with live progress in the UI.                                                                                               |
| **Save Memory**        | Stores a fact or preference to long-term memory with automatic categorization.                                                                                               |
| **Delete Memory**      | Removes a memory by ID or fuzzy content match.                                                                                                                               |
| **List Memories**      | Lists all stored memories grouped by category.                                                                                                                               |

## Code Execution (Sandbox)

YAAWC can run JavaScript code in isolated Docker containers with strict security constraints (no network, read-only filesystem, memory/CPU limits, all capabilities dropped). The agent proposes code, the user approves it in the UI, and the output is returned to the conversation.

### Enabling Code Execution

1. Set the following in `config.toml`:

   ```toml
   [TOOLS.CODE_EXECUTION]
   ENABLED = true
   DOCKER_IMAGE = "node:22-slim"
   DOCKER_HOST = "unix:///var/run/docker.sock"
   TIMEOUT_SECONDS = 30
   MEMORY_MB = 128
   MAX_OUTPUT_CHARS = 10000
   ```

2. The app needs access to a Docker daemon to create sandbox containers.

### Docker Deployment

When YAAWC itself runs in Docker (via `docker-compose`), the app creates **sibling containers** on the host Docker daemon — not Docker-in-Docker. To set this up:

1. **Mount the Docker socket** — uncomment the socket volume in `docker-compose.yaml`:

   ```yaml
   volumes:
     - /var/run/docker.sock:/var/run/docker.sock
   ```

2. **Grant socket permissions** — the app runs as the `node` user (UID 1000), which needs read/write access to the Docker socket. Uncomment and configure `group_add` in `docker-compose.yaml`:

   ```yaml
   group_add:
     - '${DOCKER_GID:-999}'
   ```

   Find your host's Docker group ID with:

   ```bash
   stat -c '%g' /var/run/docker.sock
   ```

   Then either export `DOCKER_GID` or replace `${DOCKER_GID:-999}` with the actual value. On **Docker Desktop** (Mac/Windows), the socket is generally accessible without `group_add`.

3. **Restart the stack**:

   ```bash
   docker compose up -d
   ```

### Docker Socket Proxy (More Secure)

Instead of mounting the raw Docker socket, you can use a proxy like [tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) to restrict which Docker API calls are allowed:

```yaml
# Add to docker-compose.yaml
docker-socket-proxy:
  image: tecnativa/docker-socket-proxy
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  environment:
    CONTAINERS: 1
    IMAGES: 1
    POST: 1
  networks:
    - yaawc-network
```

Then set the `DOCKER_HOST` in `config.toml`:

```toml
DOCKER_HOST = "http://docker-socket-proxy:2375"
```

### Manual (Non-Docker) Setup

If YAAWC runs directly on the host, just ensure Docker is installed and the user running the app has access to the Docker socket (typically by being in the `docker` group).

### Security Notes

Each sandbox container runs with:

- **No network access** — complete isolation from the internet and local services
- **Read-only root filesystem** — no persistent changes
- **All Linux capabilities dropped** — no privileged operations
- **Memory and CPU limits** — configurable, defaults to 128 MB / 0.5 CPU
- **Process limits** — max 32 processes (prevents fork bombs)
- **Non-root execution** — runs as UID 1000
- **User approval required** — code is shown in the UI and must be explicitly approved before execution

## Deep Research (Sub-Agents)

When the agent encounters a question that needs serious digging, it can invoke the **Deep Research** tool, which spawns an independent sub-agent with its own system prompt and tool access (`web_search`, `url_fetch`, `image_search`, `youtube_transcript`, `pdf_loader` — but not `deep_research`, because infinite recursion is nobody's friend).

Sub-agent progress streams live to the UI: task description, nested tool calls, and the final synthesized response — all collapsible and inspectable.

## Dashboard Widgets

The `/dashboard` page provides a configurable grid of AI-powered widgets:

- Fetch content from **web pages** or **HTTP endpoints**
- Process fetched content with an **AI prompt** using any configured provider/model
- **Drag, drop, and resize** widgets on a responsive grid
- **Auto-refresh** at configurable intervals (minutes/hours)
- **Export/import** dashboard configurations as JSON
- Date/time template variables for dynamic prompts (`{{current_utc_datetime}}`, `{{current_local_datetime}}`)

## Workspaces

Workspaces are project-centric containers that keep chats, uploaded files, source URLs, instructions, and memories organized under one banner. Each workspace acts as a self-contained research environment — switch between projects without mixing context.

- **Project organization** — Create workspaces with a name, description, custom color, and icon. Archive unused workspaces to keep the list tidy.
- **Per-workspace chats** — Start new chats scoped to a workspace. The agent has full awareness of the workspace's files, URLs, and instructions.
- **File management** — Upload, view, edit, and search files within a workspace. The agent can list, read, create, and edit workspace files using dedicated tools (`workspace_ls`, `workspace_read`, `workspace_grep`, `workspace_edit`, `workspace_create`). File edits require user approval in the UI.
- **Source URLs** — Attach reference URLs to a workspace for the agent to consult during research.
- **Custom instructions** — Set workspace-specific instructions and link persona prompts. These shape how the agent behaves in all workspace chats without repeating setup each time.
- **Workspace-scoped memory** — Each workspace has an isolated memory system, separate from the global memory store. Memories created inside a workspace stay with that project.
- **Auto-memory & file edits** — Toggle automatic memory extraction and auto-accept file edits per workspace.
- **Collapsible sidebar** — In workspace chats, a sidebar shows files, sources, instructions, and memory at a glance. Collapse it when you need more space.
- **Quick switching** — Hop between workspaces (or no workspace) from any chat using the workspace picker in the message input.

Configure workspaces from `/workspaces`, or pick one inline while chatting.

## LLM Providers

### Chat Models

| Provider      | Config                                                        |
| ------------- | ------------------------------------------------------------- |
| OpenAI        | API key                                                       |
| Anthropic     | API key                                                       |
| Groq          | API key                                                       |
| Google Gemini | API key                                                       |
| DeepSeek      | API key                                                       |
| OpenRouter    | API key                                                       |
| AI/ML API     | API key                                                       |
| Ollama        | Local URL, configurable context window (512 – 131,072 tokens) |
| LM Studio     | Local URL                                                     |
| Custom OpenAI | Base URL + API key + model name                               |

### Embedding Models

OpenAI, Ollama, Google Gemini, Xenova Transformers (fully local — no API needed), AI/ML API, LM Studio.

All provider keys are configurable from the Settings UI or `config.toml`. API keys are never exposed in the frontend.

## Memory

YAAWC includes a long-term memory system that lets the agent remember facts, preferences, and instructions across conversations.

### How It Works

- **Semantic retrieval**: Before each response, relevant memories are retrieved using embedding similarity and injected into the prompt as context.
- **Automatic extraction**: After each response, the agent can automatically detect and store new facts from the conversation (toggleable in Settings).
- **Deduplication**: New memories are checked for exact matches, near-duplicates, and contradictions before being stored — preventing bloat and keeping context clean.
- **Sensitivity filtering**: Passwords, API keys, emails, and other sensitive data are blocked from automatic extraction.

### Memory Categories

Memories are automatically classified into five categories: **Preference**, **Profile**, **Professional**, **Project**, and **Instruction**.

### Managing Memories

- Navigate to `/memory` to view, search, add, edit, and delete memories.
- Filter by category, sort by creation date / last accessed / times used.
- Memories can be added manually or extracted automatically from conversations.
- Use the **Re-index** button to regenerate all embeddings after changing your embedding model.

### Agent Memory Tools

The agent can also manage memories directly during a conversation using the **Save Memory**, **Delete Memory**, and **List Memories** tools.

### Settings

- **Enable/disable** the memory feature entirely.
- **Toggle automatic memory detection** on or off.
- Changing the embedding model triggers an automatic re-index of all stored memories.

## Private Sessions

Private sessions are temporary conversations that leave no lasting trace — personalization and memory are fully disabled, and the conversation is automatically deleted after a configurable duration.

### Starting a Private Session

Click **"Start private session"** at the bottom of the chat page, or navigate to `/?private=1`.

### What's Different

- **No personalization**: Location and profile context are stripped from messages.
- **No memory**: Memories are neither retrieved nor created during the session.
- **Auto-deletion**: The conversation and all its messages are deleted after the configured expiry time.
- **Visual indicator**: An amber "Private" badge with a lock icon appears in the navbar, showing the remaining time until expiry.

### Configuration

Set `PRIVATE_SESSION_DURATION_MINUTES` in `config.toml` or via the Settings page. Predefined options: 1 hour, 8 hours, 24 hours, or a custom duration. Default is 24 hours (1440 minutes).

## Personalization & Personas

### Personalization

- **Location**: Optionally bias search results with a configured location.
- **About Me**: Free-text profile for tone and context (never sent verbatim to external tools).
- **Per-message toggles**: Enable or disable location/profile injection on each message.

### Persona Prompts

Create and manage custom system prompts that shape how the agent responds:

- **Built-in templates**: Web Searches, Local Documents, Chat Conversations, Scholarly Articles
- **One-click copy** of templates as starting points for custom personas
- **Multiple personas** can be active simultaneously
- Stored in the local SQLite database

### Research Methodologies

Selectable research playbooks that tell the agent _how_ to approach a query, separate from the persona that controls _how it writes_. Pick one per message from the flask icon in the message input.

- **Built-in**: Comparative Analysis, Deep Dive / Literature Review, Fact-Check / Verification
- **Custom methodologies** can be authored from the Settings page

## Scheduled Tasks

Run agent queries automatically on a recurring schedule — useful for daily briefings, market watches, monitoring feeds, or any query you'd otherwise re-type regularly.

- **Cron-based scheduling** with friendly presets (hourly, daily, weekly, weekdays at 9am, etc.) or custom expressions
- **Per-task configuration**: chat model, system model, focus mode, persona, research methodology, and tool toggles
- **Run history** with per-run chat views — every execution produces a normal chat you can read, continue, or share
- **Unread badges** in the sidebar highlight new results since you last checked

Tasks run in-process via a scheduler started at app boot. Run results obey the same retention policy as regular chats (see below).

## Chat Retention

Configurable policies automatically clean up old data to keep the database lean. Each policy has two modes (plus `disabled`):

- **`days`** — delete chats older than N days (by creation date)
- **`count`** — keep the N most recently created chats, delete the rest

Policies are applied independently to two groups:

- **Regular chats** — global policy under `[GENERAL.RETENTION] CHATS_MODE` / `CHATS_VALUE` (disabled by default)
- **Scheduled-task runs** — global policy under `[GENERAL.RETENTION] SCHEDULED_RUNS_MODE` / `SCHEDULED_RUNS_VALUE` (disabled by default); individual scheduled tasks may override the global policy with their own mode/value
- **Private sessions** — deleted on their own expiry schedule (see [Private Sessions](#private-sessions))
- **Pinning** — individual chats can be pinned from the library to exempt them from all retention policies

Configure from the Settings page under "Retention", or via `[GENERAL.RETENTION]` in `config.toml`. Cleanup runs on a background cron alongside the private-session cleanup job.

## Conversation Compaction

Long conversations eat up context window. Compaction summarizes older messages into a dense briefing while keeping recent turns verbatim, so the agent stays informed without burning tokens.

- **Context gauge & compaction** — a circular indicator in the message input shows context usage. Click to compact the conversation, optionally with custom instructions for what the summary should capture.
- **Adjustable context window** — pick a preset size or enter a custom value to match your model.

## Search Providers

YAAWC supports multiple search backends and lets you choose from the Settings page:

| Provider    | Capabilities                      | Config                         |
| ----------- | --------------------------------- | ------------------------------ |
| **SearXNG** | Web, images, videos, autocomplete | Self-hosted URL (default)      |
| **Brave**   | Web, images, videos, autocomplete | API key (+ optional Brave LLM) |
| **Mojeek**  | Web                               | API key                        |

## Installation

### Docker (Recommended)

1. Ensure Docker is installed and running.
2. Clone the repository:

   ```bash
   git clone https://github.com/boarder2/Yet-Another-Agentic-Web-Chat.git
   cd Yet-Another-Agentic-Web-Chat
   ```

3. Rename `sample.config.toml` to `config.toml` and fill in the provider keys you plan to use:

   | Key          | Required When                                                 |
   | ------------ | ------------------------------------------------------------- |
   | `OPENAI`     | Using OpenAI models                                           |
   | `OLLAMA`     | Using Ollama (`http://host.docker.internal:11434` for Docker) |
   | `GROQ`       | Using Groq                                                    |
   | `OPENROUTER` | Using OpenRouter                                              |
   | `ANTHROPIC`  | Using Anthropic                                               |
   | `GEMINI`     | Using Google Gemini                                           |
   | `DEEPSEEK`   | Using DeepSeek                                                |
   | `AIMLAPI`    | Using AI/ML API                                               |
   | `LM_STUDIO`  | Using LM Studio                                               |

   > All keys can also be changed later from the Settings page.

4. Start the stack:

   ```bash
   docker compose up -d
   ```

5. Open http://localhost:3000.

### Manual Setup

1. Install and configure [SearXNG](https://github.com/searxng/searxng) with JSON output enabled.
2. Clone the repo, copy `sample.config.toml` → `config.toml`, and fill in your settings.
3. Install dependencies and build:

   ```bash
   yarn install
   yarn build
   yarn start
   ```

See [docs/installation](docs/installation) for additional configuration, updating, and tracing setup.

### Ollama Connection Errors

| OS                     | Recommended URL                     |
| ---------------------- | ----------------------------------- |
| Windows / Mac (Docker) | `http://host.docker.internal:11434` |
| Linux (Docker)         | `http://<host-private-ip>:11434`    |

On Linux, you may also need to set `Environment="OLLAMA_HOST=0.0.0.0"` in `/etc/systemd/system/ollama.service` and restart Ollama. See the [Ollama FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.md#setting-environment-variables-on-linux) for details.

## Using as a Browser Search Engine

1. Open your browser's **Search Engines** settings.
2. Add a new search engine with URL: `http://localhost:3000/?q=%s`
   (replace `localhost:3000` with your host and port as needed).
3. YAAWC also exposes an **OpenSearch description** at `/api/opensearch` with autocomplete support, so some browsers can discover and add it automatically.

URL queries via `?q=` automatically apply your saved model preferences for a seamless search-bar experience.

## API

YAAWC exposes a full API for programmatic access:

| Endpoint                                  | Method              | Description                                                    |
| ----------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `/api/chat`                               | POST                | Streaming chat with tool calls, sources, and live events (SSE) |
| `/api/models`                             | GET                 | List available models (`?include_hidden=true` for admin view)  |
| `/api/config`                             | GET/POST            | Read/write server configuration                                |
| `/api/chats`                              | GET                 | List all chats (paginated)                                     |
| `/api/chats/[id]`                         | GET/DELETE/PATCH    | Get, delete, or update (e.g. pin) a specific chat              |
| `/api/chats/search`                       | GET                 | Full-text search across chat history                           |
| `/api/suggestions`                        | POST                | Generate follow-up suggestions                                 |
| `/api/system-prompts`                     | GET/POST/PUT/DELETE | CRUD for persona prompts                                       |
| `/api/images`                             | POST                | Image search                                                   |
| `/api/videos`                             | POST                | Video search                                                   |
| `/api/uploads`                            | POST                | File upload                                                    |
| `/api/uploads/images`                     | POST/GET            | Image upload and serving                                       |
| `/api/memories`                           | GET/POST/DELETE     | List, add, or delete all memories                              |
| `/api/memories/[id]`                      | PUT/DELETE          | Update or delete a specific memory                             |
| `/api/memories/reindex`                   | POST                | Regenerate all memory embeddings                               |
| `/api/tools`                              | GET                 | List available agent tools                                     |
| `/api/dashboard`                          | GET/POST            | Dashboard widget CRUD                                          |
| `/api/respond-now`                        | POST                | Interrupt retrieval for immediate response                     |
| `/api/opensearch`                         | GET                 | OpenSearch description XML                                     |
| `/api/autocomplete`                       | GET                 | Search autocomplete (via configured search provider)           |
| `/api/scheduled-tasks`                    | GET/POST            | List or create scheduled tasks                                 |
| `/api/scheduled-tasks/[id]`               | GET/PUT/DELETE      | Get, update, or delete a scheduled task                        |
| `/api/scheduled-tasks/[id]/run`           | POST                | Trigger an immediate run of a scheduled task                   |
| `/api/scheduled-tasks/[id]/runs`          | GET                 | List run history for a scheduled task                          |
| `/api/scheduled-tasks/runs`               | GET                 | List recent runs across all scheduled tasks                    |
| `/api/scheduled-tasks/runs/unread`        | GET                 | Count of unread scheduled-task run results                     |
| `/api/workspaces`                         | GET/POST            | List all workspaces or create a new one                        |
| `/api/workspaces/[id]`                    | GET/PUT/DELETE      | Get, update, or delete a workspace                             |
| `/api/workspaces/[id]/archive`            | POST                | Archive a workspace                                            |
| `/api/workspaces/[id]/unarchive`          | POST                | Unarchive a workspace                                          |
| `/api/workspaces/[id]/files`              | GET/POST            | List or upload workspace files                                 |
| `/api/workspaces/[id]/files/[fid]`        | GET/PUT/DELETE      | Get, update, or delete a workspace file                        |
| `/api/workspaces/[id]/urls`               | GET/PUT             | Get or update workspace source URLs                            |
| `/api/workspaces/[id]/urls/check`         | GET                 | Check reachability of workspace source URLs                    |
| `/api/workspaces/[id]/system-prompts`     | GET/PUT             | Get or update linked persona prompts                           |
| `/api/workspaces/[id]/file-edit-approval` | POST                | Approve or reject a pending agent file edit                    |

For detailed payload schemas, see the [API documentation](docs/API/).

## Network & Reverse Proxy

YAAWC runs on Next.js and is accessible on the local network out of the box. For reverse proxy deployments:

1. Set `BASE_URL` in `config.toml` under `[GENERAL]` to your public URL.
2. Forward headers: `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`.

Example Nginx config:

```nginx
server {
  listen 80;
  server_name yaawc.yourdomain.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
  }
}
```

## Observability

Built-in support for **Langfuse** and **LangSmith** tracing. Configure via environment variables (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`). See [docs/installation/TRACING.md](docs/installation/TRACING.md) for setup details.

The UI also displays live **token usage stats** (chat vs. system model), response times, and model names per message.

## Contributing

Found a bug? Have an idea? Open an issue or submit a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Acknowledgements

YAAWC is built on the foundation of [Perplexica](https://github.com/ItzCrazyKns/Perplexica), an open-source AI-powered search engine. We're grateful for their work and encourage you to check out the original project.

## A Note on AI Assistance

Yes, a significant portion of this README — and frankly quite a bit of the code in this repo — was written with AI assistance. I know, I know. The irony of using an AI-powered tool to build and document an AI-powered tool is not lost on me. In my defense, I'm a software developer with over 25 years of experience and I review every change, so hopefully the quality bar is _somewhat_ higher than "the AI just vibed it." This is a side project for me to explore agentic architectures and AI tooling.

If you find something that looks suspiciously like a hallucination… well, YOLO, right? Just kidding. Please open an issue and I'll fix it ASAP.
