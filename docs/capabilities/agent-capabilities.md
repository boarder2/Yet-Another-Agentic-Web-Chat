# Agent capabilities

The top-level agent chooses tools from the active focus mode and the current run context. Tool calls stream into the chat and their returned documents can become cited sources. The chat composer does not expose a general on/off switch for individual agent tools; focus mode, private state, workspace state, and configuration determine availability.

## Research and retrieval tools

| Capability                      | What it does                                                                                                                   | Availability                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Web search                      | Searches the configured web provider and returns up to 20 ordered results per call                                             | Web Search; private chats use their resolved private provider               |
| URL retrieval                   | Reads a page, uses short content directly, and summarizes longer content unless full content is requested                      | Web Search and deep research; requires a reachable URL                      |
| Image search                    | Returns image sources and thumbnails                                                                                           | Web Search when the resolved provider supports image search                 |
| Image analysis                  | Fetches a direct PNG, JPEG, GIF, or WebP URL and asks a vision-capable System model to analyze it; images are limited to 10 MB | Web Search when a vision-capable System model is available                  |
| PDF loading                     | Extracts text from a PDF URL                                                                                                   | Web Search; the URL must return readable PDF content                        |
| YouTube transcripts             | Retrieves a usable caption track from a YouTube video                                                                          | Web Search; videos without usable captions cannot produce a transcript      |
| File search                     | Performs embedding-based similarity search over attached chat documents                                                        | Local Research, or Web Search when documents are attached                   |
| Chat history and message lookup | Finds matching non-private prior conversations and retrieves a selected message by its numeric ID                              | Top-level chats; workspace scope is enforced and private chats are excluded |
| Deep research                   | Runs a focused web-research subagent and merges its findings into the parent answer                                            | Web Search only; see [Deep research](#deep-research)                        |

## Answers, charts, and media

- `todo_list` maintains a visible plan of up to 10 tasks. It is state management and does not call an external model.
- `create_chart` renders validated interactive bar, line, area, or pie/donut charts in the answer. It needs an interactive top-level stream; code execution can also emit chart data.
- Image generation is available in a durable top-level chat when it is enabled with an OpenRouter image model. It supports the configured default aspect ratio and resolution, with per-request overrides. See [Models and providers](./models-and-providers.md).
- Artifact tools create, edit, and read self-contained HTML documents. They are available only where artifacts can be owned; private chats withhold them. See [Artifacts and dashboards](./artifacts-and-dashboards.md).
- Workspace tools list, read, search, create, and edit files when the chat belongs to a workspace. See [Files and workspaces](./files-and-workspaces.md).

## Deep research

Deep Research sends one focused task to an independent subagent. The subagent receives a limited recent context and can use `web_search`, `url_fetch`, `image_search`, `image_analysis`, and `pdf_loader`. It cannot use file search, code execution, ask-user, charts, artifact tools, or another deep-research run. A subagent is limited to about 10 turns and at most 8 web searches for its task.

The parent agent receives the subagent summary and its source documents. A failed subagent does not make up evidence; the parent can report the failure or continue with other sources.

## Skills and instructions

Built-in skills explain specialized tool contracts such as deep research, chart creation, ask-user, and code execution. User skills can be global or workspace-scoped, enabled or disabled, automatically offered to the model, or marked slash-only. Type `/skill-name` in the composer to invoke an enabled skill explicitly. The agent can load a skill with `read_skill` and can propose creating, updating, or deleting a user skill with `edit_skill`.

Skill edits require user approval in an interactive chat. A workspace skill can override a global user skill with the same name, but built-in skill names remain reserved. Persona prompts control response style; skills can add task-specific instructions. See [Personalization and memory](./personalization-and-memory.md) for persona settings.

## Interactive approvals and questions

The agent may pause a top-level interactive run for:

- A clarifying question with selectable options or free-form input.
- Code execution approval, including an optional denial reason.
- A workspace file create or edit approval.
- A skill create, update, or delete approval.
- An MCP tool approval unless that tool is configured to auto-run.

The run remains resumable while it awaits an answer. Approvals survive a browser reconnect and are restored when the chat is opened again. A stale file or skill snapshot is rejected rather than applying an outdated change.

Subagents, panels, and scheduled runs do not have an interactive user approval surface. Those contexts either omit approval-gated tools or receive a safe unavailable result. A manual workflow run is a continuable chat, so after navigation it can use the same interactive approval behavior while still omitting workspace, MCP, memory, and panel state.

## Sandboxed code execution

Enable code execution in `config.toml` under `[TOOLS.CODE_EXECUTION]` and provide a reachable Docker daemon. The default limits are a 30-second timeout, 128 MB memory, and 50,000 output characters; code input is limited to 50,000 characters. The runtime uses an official Node image, drops Linux capabilities, runs without network access, and does not give user code access to the host filesystem.

Every top-level interactive call shows the JavaScript and asks for approval before running. Code execution is unavailable in subagents and non-interactive workflow or scheduled contexts. Docker being configured is not the same as Docker being reachable; the tool checks the daemon when a call is requested. Detailed deployment settings are in the [configuration guide](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/docs/installation/configuration.md).

## MCP tools

Configured MCP servers can add remote tools to top-level tool runs. Server scope, per-tool enablement, and approval policy are applied before injection. MCP setup and failure handling are covered in [Administration and settings](./administration-and-settings.md).

## Limits and failure behavior

A provider may omit a capability, return no results, reject a model request, or time out. The agent receives the tool's bounded error or no-result message and should not turn it into a citation. Tools that need an interactive stream, durable chat, workspace, vision model, embedding model, Docker daemon, or configured provider fail closed when that prerequisite is absent.

Tool output can add context to the current turn and selected outputs are persisted for later turns. Persisted tool context is capped; a later turn may need to call the original tool again for more detail. External service failures do not make local tools such as todo tracking or capability-independent conversation unavailable.
