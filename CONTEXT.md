# YAAWC

An agentic web chat app: user queries flow through a LangGraph agent that uses tools (web search, file search, MCP tools) to research and answer with cited sources.

## Language

**Unscoped chat**:
A chat with no `workspaceId` — not tied to any workspace.
_Avoid_: General chat, default chat, non-workspace chat

**Workspace-scoped chat**:
A chat with a `workspaceId`, running inside a specific workspace's context (instructions, files, memories).
_Avoid_: Workspace chat (ambiguous with the workspace entity itself)

**MCP server scope**:
The set of workspaces an MCP server's tools are available in. An empty scope means the server is available in every chat, unscoped and workspace-scoped alike. A non-empty scope restricts the server to only the listed workspaces' chats.
_Avoid_: Workspace restriction, server visibility

**visibleInGeneralChat**:
A per-server flag, meaningful only when its scope is non-empty, that additionally exposes the server's tools to unscoped chats without granting access to any workspace outside its configured scope.
_Avoid_: includeUnscoped, global visibility

**Stream event**:
A single typed item crossing the agent→UI seam (`src/lib/streaming/events.ts`). `AgentEmitEvent` is what producers emit on the run emitter; `StreamEvent` is the wire form (NDJSON) the client folds through the reducer.
_Avoid_: SSE message, chunk, packet

**Run-host synthesis**:
The `runHost` step that turns raw `AgentEmitEvent`s into wire `StreamEvent`s — stamping the assistant `messageId`, accumulating markup, and adding events with no producer (`messageEnd`, `replay_complete`, `gone`, `*_pending`/`*_answered`).
_Avoid_: event forwarding, proxying

**Stream effect**:
A `StreamEffect` value the reducer returns alongside new state to request a side effect (toast, scroll, cache invalidation, suggestion fetch); `ChatWindow` performs them. The reducer itself stays pure.
_Avoid_: side-effect callback, action
