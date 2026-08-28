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

**Tool context**:
The typed, run-scoped data every tool receives via LangChain's `ToolRuntime.context` (IDs, the emitter, and other invocation-time config assembled once per run). Distinct from LangChain's own generic "context" mechanism — this is YAAWC's specific schema for it.
_Avoid_: configurable, config.configurable

**Soft stop**:
A user-initiated request to stop an in-flight run, checked by tools before they execute. Distinct from LangGraph's `interrupt()` (which pauses for resumable human input) and from `retrievalSignal` (an `AbortSignal` for in-flight cancellation) — soft stop is a pre-execution gate backed by an in-memory per-`messageId` registry.
_Avoid_: cancellation, interrupt

**Mapping provider**:
A configured server-side adapter for named-place search, place details, nearby records, and supported route summaries. The shipped OpenStreetMap-compatible adapter uses Nominatim, Overpass, OSRM, and configured raster tiles; the deterministic test adapter never contacts a network service.
_Avoid_: map API, geolocation provider

**Map spec**:
A validated provider-grounded snapshot containing places, an optional route, attribution, and retrieval time. A persistable map spec is safe for assistant metadata and replay; it does not contain a transient browser origin or route geometry when the user chose Use once.
_Avoid_: map payload, map markup

**Turn-local map registry**:
The per-turn server registry that maps short model-visible place/map/route handles to private canonical records and enforces the one-map, one-route, and 12-pin limits. Only the writer can turn a registered handle into a map placement.
_Avoid_: map cache, model map ID

**Location approval**:
The explicit interactive approval shown before the browser requests precise location. It discloses authorized provider/tile hosts and offers Use once, Use and save where allowed, or Cancel; browser coordinates travel through a dedicated opaque-token boundary rather than a generic resume payload.
_Avoid_: automatic geolocation, IP location

**Session overlay**:
A live-only, page-session-bound stream event for an exact browser origin or route. It is not sequenced, persisted, replayed after reload, or delivered to another subscriber.
_Avoid_: persisted location, location event
