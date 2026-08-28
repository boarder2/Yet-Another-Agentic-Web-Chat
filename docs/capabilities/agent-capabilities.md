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

## Mapping tools

When Mapping is enabled by the operator, an ordinary interactive top-level Web Search turn can use `search_places`, `get_place_details`, `get_route`, `request_location`, and `show_map`. Place and route results are provider-validated and expose short handles valid only in the current turn; discovery does not place a map, and the model never supplies coordinates or map markup. Each `show_map` call explicitly selects place handles and an optional route handle, creating one immutable writer-owned placement; a single answer can contain any number of maps. Every map has at most 12 unique pins, counting route endpoints, and one route, while the answer retains an equivalent numbered prose summary, normal citations for factual business claims, complete attribution, and external links.

Mapping tools are absent from Chat, Local Research, Agent Panel executors/synthesis, deep-research children, workflows, schedules, dashboards, Firefox-restricted turns, and other non-interactive paths. Public endpoints require both explicit Mapping enablement and public-service acknowledgement; self-hosted endpoints still require explicit enablement. Invalid handle selections fail without a partial map; provider, route, tile, and permission failures leave validated prose and other successful maps available without guessing.

## Answers, charts, and media

- `todo_list` maintains a visible plan of up to 10 tasks. It is state management and does not call an external model.
- `create_chart` validates and registers a turn-local chart; `show_chart` places a chart-only writer widget at that point in the answer. The model uses a short handle returned by `create_chart` (never an internal ID or HTML tag), and a registered chart may be shown more than once. These tools are available in Web Search, Local Research, and Chat focus modes on any top-level run, including headless scheduled-task and workflow runs. Agent Panel executor columns can place their own charts inside the column that produced them. Deep-research subagents cannot use them. A chart that is registered but never shown remains invisible, so every registration result — from `create_chart` and from code execution alike — restates that the chart is not visible until `show_chart` places it.
- Chart input uses a required title, aligned numeric series over string-or-number labels, or labeled non-negative pie slices. Titles and displayed labels are trimmed and unique; limits are 100 labels, 15 series, and 20 slices, with optional valid CSS colors and only type-appropriate options. One turn can register at most 10 charts and show charts at most 20 times; a call past either cap fails with the turn's remaining handles. Code execution's global `chart(spec)` helper uses the same simplified input and returns ordered handles after a clean run; code execution can be used for computed data.

A hand-authored chart follows this lifecycle; the returned handle is valid only in the current turn:

```text
create_chart({ type: "line", title: "Trend", labels: ["A", "B"], series: [{ label: "Value", values: [1, 2] }] })
show_chart({ handle: "chart_1" })
```

If a model narrates a placement instead of calling `show_chart` — writing `{chart_1}`, `[chart_1]`, or a bare `show_chart` line into the answer — that chart is placed where the mention appears, unless it was already shown. The mention text itself is always removed from the answer, whether or not it named a chart from this turn.

- Image generation is available in a durable top-level chat when it is enabled with an OpenRouter image model. It supports the configured default aspect ratio and resolution, with per-request overrides. See [Models and providers](./models-and-providers.md).
- Artifact tools create, edit, and read self-contained HTML documents. They are available only where artifacts can be owned; private chats withhold them. See [Artifacts and dashboards](./artifacts-and-dashboards.md).
- Workspace tools list, read, search, create, and edit files when the chat belongs to a workspace. See [Files and workspaces](./files-and-workspaces.md).

## Deep research

Deep Research sends one focused task to an independent subagent. The subagent receives a limited recent context and can use `web_search`, `url_fetch`, `image_search`, `image_analysis`, and `pdf_loader`. It cannot use file search, code execution, ask-user, charts, artifact tools, or another deep-research run. A subagent is limited to about 10 turns and at most 8 web searches for its task.

The parent agent receives the subagent summary and its source documents. A failed subagent does not make up evidence; the parent can report the failure or continue with other sources.

## Skills and instructions

Built-in skills explain specialized tool contracts such as deep research, the optional chart-creation reference, ask-user, and code execution. User skills can be global or workspace-scoped, enabled or disabled, automatically offered to the model, or marked slash-only. Type `/skill-name` in the composer to force an enabled skill's instructions into that turn; this does not depend on the model choosing to load it. The agent can load a non-invoked skill with `read_skill` and can propose creating, updating, or deleting a user skill with `edit_skill`.

Skill edits require user approval in an interactive chat. A workspace skill can override a global user skill with the same name, but built-in skill names remain reserved. Persona prompts control response style; skills can add task-specific instructions. See [Personalization and memory](./personalization-and-memory.md) for persona settings.

## Interactive approvals and questions

The agent may pause a top-level interactive run for:

- A clarifying question with selectable options or free-form input.
- Browser-location approval for a Mapping turn. The panel lists authorized provider/tile hosts and offers **Use once**, **Use and save** where the chat permits it, or **Cancel**; browser permission is requested only after a choice.
- Code execution approval, including an optional denial reason.
- A workspace file create or edit approval.
- A skill create, update, or delete approval.
- An MCP tool approval unless that tool is configured to auto-run.

The run remains resumable while it awaits an answer. Approvals survive a browser reconnect and are restored when the chat is opened again. A stale file or skill snapshot is rejected rather than applying an outdated change.

Subagents, panels, and scheduled runs do not have an interactive user approval surface. Those contexts either omit approval-gated tools or receive a safe unavailable result. A manual workflow run is a continuable chat, so after navigation it can use the same interactive approval behavior while still omitting workspace, MCP, memory, and panel state.

## Sandboxed code execution

Enable code execution in `config.toml` under `[TOOLS.CODE_EXECUTION]` and provide a reachable Docker daemon. The default limits are a 30-second timeout, 128 MB memory, and 50,000 output characters; code input is limited to 50,000 characters. The runtime uses an official Node image, drops Linux capabilities, runs without network access, and does not give user code access to the host filesystem.

Every top-level interactive call shows the JavaScript and asks for approval before running. The global `chart(spec)` helper accepts the simplified chart input, captures chart records privately, and returns short handles only after a clean execution; nonzero, timed-out, or out-of-memory runs register no charts. Code execution is unavailable in subagents and non-interactive workflow or scheduled contexts. Docker being configured is not the same as Docker being reachable; the tool checks the daemon when a call is requested. Detailed deployment settings are in the [Configuration](./configuration.md) guide.

## MCP tools

Configured MCP servers can add remote tools to top-level tool runs. Server scope, per-tool enablement, and approval policy are applied before injection. MCP setup and failure handling are covered in [Administration and settings](./administration-and-settings.md).

## Limits and failure behavior

A provider may omit a capability, return no results, reject a model request, or time out. The agent receives the tool's bounded error or no-result message and should not turn it into a citation. Tools that need an interactive stream, durable chat, workspace, vision model, embedding model, Docker daemon, or configured provider fail closed when that prerequisite is absent.

Tool output can add context to the current turn and selected outputs are persisted for later turns. Persisted tool context is capped; a later turn may need to call the original tool again for more detail. External service failures do not make local tools such as todo tracking or capability-independent conversation unavailable.
