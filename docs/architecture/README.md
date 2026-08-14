# YAAWC architecture

These pages describe implementation boundaries for contributors. The authoritative user-facing capability descriptions live in [`docs/capabilities/`](../capabilities/README.md); do not use this overview as a feature or availability reference.

YAAWC is composed of:

1. **User interface:** Next.js App Router and React pages for chat, history, workspaces, automations, dashboards, settings, and streaming controls.
2. **LangGraph React agent:** `SimplifiedAgent` selects a focus-mode toolset, composes prompt layers, invokes the Chat and System models, and emits the turn's stream events.
3. **Streaming seam:** typed agent events are synthesized by the run host into persisted and reconnectable stream events consumed by the client reducer.
4. **Retrieval and tools:** search providers, URL/PDF/YouTube readers, file search, deep-research subagents, workspace tools, skills, memory, artifacts, charts, and approval-gated actions.
5. **Providers:** configurable Chat, System, embedding, image-generation, and search providers. Model and search availability is resolved from the deployment's settings and credentials.
6. **Local persistence:** SQLite and Drizzle store chats, run state, settings, credentials, memories, workspaces, workflows, schedules, MCP configuration, skills, artifacts, and generated-image metadata.

## Focus modes

`SimplifiedAgent` chooses the base toolset from the focus mode:

- **Web Search:** the broad research toolset, plus file search when documents are attached.
- **Local Research:** file search, core interaction tools, charts, and artifact support without web search.
- **Chat:** core conversational tools without web or file research.

Interactive tools such as user questions, skill edits, and configured code execution are appended by dynamic top-level getters. Workspace and MCP tools are injected from the active chat context. Panel executors and deep-research subagents apply narrower restrictions rather than inheriting every top-level action.

For the request-to-answer flow and the source/citation pipeline, see [WORKING.md](./WORKING.md).
