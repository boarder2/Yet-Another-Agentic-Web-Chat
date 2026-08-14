# Chat and research

YAAWC turns a message into a streamed assistant response. The agent can gather sources, call tools, and cite returned documents. Start from `/` for a new conversation, or open an existing conversation from `/history`.

## Choose a focus mode

The composer has three focus modes. The Web Search mode is labelled **All** in the current composer.

| Mode                                 | What it is for                                                                      | Main retrieval scope                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Web Search** (`webSearch`)         | Research current information across the internet                                    | Web, URL, image, PDF, video-transcript, deep-research, chart, artifact, history, skill, and other configured tools                  |
| **Chat** (`chat`)                    | Conversation, drafting, explanation, and creative work without web or file research | Conversational tools such as history lookup, skills, interactive questions, code when enabled, and image generation when configured |
| **Local Research** (`localResearch`) | Ask questions about attached documents with citations                               | File search plus core interaction, chart, artifact, and configured image-generation tools; no web search                            |

Web Search can also use attached chat documents when files are supplied. A workspace adds its own file and workspace tools; see [Files and workspaces](./files-and-workspaces.md).

## Compose a message

1. Choose a focus mode and, if needed, a model preset or individual Chat and System models.
2. Optionally attach PDF, DOCX, or TXT documents. Image attachments and clipboard image paste require a vision-capable Chat model.
3. Select persona prompts to control response tone, formatting, and citation style. In Web Search and Local Research, select one research methodology when you want to change the investigation process.
4. Use the personalization controls only when saved location or profile context should affect the response. Private sessions omit these controls.
5. Submit with Enter. Use Shift+Enter for a newline. Press `/` when the composer is not focused to focus it.

The System model performs internal work such as retrieval processing and the Chat model writes the answer. If no separate System model is selected, the Chat model is used for both roles. A workspace model override can replace the selections for every chat in that workspace.

## Follow the live answer

Responses stream into the conversation while the agent works. The answer can show:

- Tool-call cards with the operation, query or detail, and success or failure state.
- Reasoning panels when the model provides reasoning content.
- Todo progress for multi-step work and expandable deep-research or panel activity.
- Source cards with titles, previews, processing indicators, and numbered citation links.
- Images and Videos panels when the resolved search capabilities support them.
- Related suggestions after completion when automatic suggestions are enabled, or after selecting **Load suggestions**.

A citation is usable only when the corresponding tool returned a source document. Search snippets may be followed by URL retrieval, PDF text extraction, or a YouTube transcript before the final answer is written. A provider error, blocked page, missing transcript, or empty result can leave a tool without a source.

## Control a conversation

- Stop an in-progress run from the composer. **Answer now** asks the agent to synthesize from sources already gathered instead of continuing retrieval.
- Edit a user message to rebuild the conversation from that turn onward. Later messages and turn-scoped generated history are discarded.
- Rename a conversation from its title. Automatic titles can be disabled in Settings.
- Rewrite an assistant answer, copy the response with its citations, or read it aloud.
- Export a conversation as Markdown or PDF from the chat header.
- Use the context indicator to compact a long conversation into a summary. Compaction is unavailable while a run is active and requires enough completed messages to summarize.

## Search from a browser

YAAWC publishes an OpenSearch descriptor at `/api/opensearch`. A browser search-engine entry can send `?q=` requests to the home route, which starts a chat using the saved default search model. Autocomplete is provided by the resolved search provider when that capability is available.

## Prerequisites and limits

- Chat and System models must resolve before a run can start. A selected model may disappear when a provider changes or becomes unavailable.
- Web, image, video, and autocomplete features depend on the selected primary and fallback search providers. Private chats may use a different primary search provider.
- File research needs an embedding model and processable attached content. See [Files and workspaces](./files-and-workspaces.md) for document formats and indexing behavior.
- Agent Panel mode is available only in Web Search and Local Research and needs two to four usable executor models. See [Agent capabilities](./agent-capabilities.md).
- Firefox AI prompts that match the page-selection format are handled conversationally with external and action tools disabled for that turn. The local capability-documentation lookup remains available when a YAAWC claim must be verified.

## If a run does not work

A missing model or encryption passphrase is reported before the run starts. Search providers can return no results or fail to provide a particular capability; the UI reflects unavailable image or video panels rather than inventing results. A URL that cannot be fetched, a PDF without extractable text, or a video without a usable transcript cannot be cited. If a run is stopped, cancelled, interrupted for user input, or disconnected, open it again from History to see its persisted state.

For data boundaries, external services, private sessions, and deletion behavior, see [Privacy and data](./privacy-and-data.md). For provider setup, see [Models and providers](./models-and-providers.md).
