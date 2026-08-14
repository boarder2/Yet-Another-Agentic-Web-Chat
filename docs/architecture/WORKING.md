# How YAAWC works

This document is an implementation walkthrough. Read the [capability corpus](../capabilities/README.md) for user-facing behavior and prerequisites.

## From request to answer

1. The `/api/chat` route receives the message, focus mode, selected Chat/System models, attached file IDs, prompt selections, and run options. It resolves models and embeddings from configured providers and loads the chat's authoritative workspace context.
2. The route reads ambient settings such as memory and personalization, loads applicable workspace instructions and skills, and creates a `SimplifiedAgent` with run-scoped IDs, abort controls, token tracking, and an event emitter.
3. `SimplifiedAgent` builds the focus-mode toolset and appends context-specific workspace and MCP tools. Web Search uses the broad research set, Local Research uses file search plus core tools, and Chat uses the core conversational set. Interactive tools are available only where the run has an interactive surface.
4. The LangGraph agent chooses tools and streams model/tool events. Retrieval tools add `Document` values to `relevantDocuments`; source IDs are assigned as documents enter the turn so final citations can index the same ordered set.
5. The run host persists assistant content, sources, model usage, tool widgets, approvals, and reconnectable run events. The client folds the wire events through its reducer and renders the answer, source cards, tool calls, subagent activity, panels, and approval controls.

## Focus and child runs

A deep-research call creates an isolated `SubagentExecutor` with a fixed web-research whitelist and no recursive deep research. An Agent Panel runs two to four restricted `SimplifiedAgent` executors concurrently, merges and deduplicates their documents, and gives the Chat model a synthesis context. Neither child surface receives the parent's approval-gated mutation tools.

Manual workflows and scheduled tasks construct agents from their stored workflow configuration. They intentionally do not inherit the caller's workspace, MCP, memory, or panel state. Scheduled runs persist headlessly and cannot wait for interactive approvals.

## Sources and citations

Search tools return LangChain `Document` objects with title, URL, processing, and query metadata. URL retrieval may return direct content or a System-model summary; file search returns ranked excerpts with file metadata. The final response cites documents by one-based `[n]` markers, and the UI resolves each marker against the assistant message's source array.

## Other retrieval paths

Image and video panels use the resolved search capabilities after an answer. Image analysis and PDF/transcript tools add their returned documents to the same retrieval context. Workspace files use content-addressed blobs and compare-and-swap writes so concurrent edits cannot silently replace one another. Artifacts use immutable message-anchored versions and are scoped to a chat or workspace.
