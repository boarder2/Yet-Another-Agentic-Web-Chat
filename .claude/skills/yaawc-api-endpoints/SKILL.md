---
name: yaawc-api-endpoints
description: Use when adding, modifying, or debugging API endpoints, request/response schemas, payload formats, or the chat and search route handlers.
---

# API Endpoints & Data Flow

## Chat Endpoint (`POST /api/chat`)

**Source**: `src/app/api/chat/route.ts`

**Request body**:

```typescript
{
  message: {
    messageId: string;   // Unique message ID
    chatId: string;      // Chat session ID
    content: string;     // User message text
  };
  focusMode: string;     // "webSearch" | "localResearch" | "chat"
  files: string[];       // Attached file references
  chatModel: { provider: string; name: string; contextWindowSize?: number };
  systemModel?: { provider: string; name: string; contextWindowSize?: number };
  // Embedding model is NOT sent: it's a system-level setting resolved
  // server-side from the DB (app_settings) so indexing and querying always
  // agree. See resolveChatAndEmbedding / getEmbeddingModelSelection.
  selectedSystemPromptIds: string[];  // Persona prompt IDs (legacy name)
  selectedMethodologyId?: string;
  messageImageIds?: string[];
  messageImages?: Array<{ imageId: string; fileName: string; mimeType: string }>;
  // Server-authoritative: route reads these from the DB (app_settings) and
  // overwrites any client value; the UI no longer sends them. Private sessions strip them.
  userLocation?: string;
  userProfile?: string;
  memoryEnabled?: boolean;
  memoryAutoDetection?: boolean;
  isPrivate?: boolean;
  workspaceId?: string | null;
  imageCapable?: boolean;
  invokedSkills?: string[];   // Skill names user explicitly triggered
}
```

**Idempotency**: If `message.messageId` already has a live run (`running` or `awaiting_user`), the request re-subscribes to the existing run's event stream instead of starting a duplicate.

**Response**: SSE stream of newline-delimited JSON objects (text/event-stream):

```
{"type":"response","data":"token text","messageId":"..."}
{"type":"sources","data":[...],"searchQuery":"...","searchUrl":"...","messageId":"..."}
{"type":"sources_added","data":[...],"messageId":"..."}
{"type":"tool_call_started","data":{...},"messageId":"..."}
{"type":"tool_call_success","data":{...},"messageId":"..."}
{"type":"tool_call_error","data":{...},"messageId":"..."}
{"type":"subagent_started","executionId":"...","name":"...","task":"...","messageId":"..."}
{"type":"subagent_data","subagentId":"...","data":{...},"messageId":"..."}
{"type":"subagent_completed","id":"...","summary":"...","messageId":"..."}
{"type":"subagent_error","id":"...","error":"...","messageId":"..."}
{"type":"chart_spec","data":{"chartId":"...","spec":{...}},"messageId":"..."}
{"type":"todo_update","data":{...},"messageId":"..."}
{"type":"code_execution_pending","data":{...},"messageId":"..."}
{"type":"code_execution_result","data":{...},"messageId":"..."}
{"type":"user_question_pending","data":{...},"messageId":"..."}
{"type":"user_question_answered","data":{...},"messageId":"..."}
{"type":"ask_user_pending","data":{"approvalId":"...","toolCallId":"...",...},"messageId":"..."}
{"type":"ask_user_answered","data":{...},"messageId":"..."}
{"type":"ask_user_cancelled","data":{"approvalId":"..."},"messageId":"..."}
{"type":"workspace_edit_pending","data":{...},"messageId":"..."}
{"type":"workspace_edit_answered","data":{...},"messageId":"..."}
{"type":"workspace_create_pending","data":{...},"messageId":"..."}
{"type":"workspace_create_answered","data":{...},"messageId":"..."}
{"type":"skill_edit_pending","data":{...},"messageId":"..."}
{"type":"skill_edit_answered","data":{...},"messageId":"..."}
{"type":"mcp_tool_pending","data":{...},"messageId":"..."}
{"type":"mcp_tool_answered","data":{...},"messageId":"..."}
{"type":"context_grew","kind":"...","tokens":...,"totalEstimated":...,"messageId":"..."}
{"type":"workspace_file_changed","data":{...},"messageId":"..."}
{"type":"artifact_saved","data":{"artifactId":"...","title":"...","version":1,"action":"create"|"edit"},"messageId":"..."}
{"type":"progress","data":"...","messageId":"..."}
{"type":"stats","data":{"modelName":"...","usageChat":{...},"usageSystem":{...},...},"messageId":"..."}
{"type":"memory_updated","data":{"saved":...,"updated":...,"memoryIds":[...]},"messageId":"..."}
{"type":"messageEnd","messageId":"...","modelStats":{...},"searchQuery":"...","usedLocation":...,"usedPersonalization":...,"memoriesUsed":[...],"projectedNextInputTokens":...}
{"type":"error","data":"..."}
{"type":"gone"}
```

Note: The old `{"type":"init"}`, `{"type":"modelStats"}`, and `{"type":"end"}` event types are gone. `messageEnd` replaces `end`/`modelStats`. `stats` carries live model stats mid-stream.

## Run Management Endpoints

| Endpoint                            | Method | Purpose                                                                                                                                                                                                         |
| ----------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/chat/cancel`                  | POST   | Hard-cancel a run. Body: `{ messageId: string }`                                                                                                                                                                |
| `/api/chat/compact`                 | POST   | Summarize a chat's history to compress context. Body: `{ chatId, instructions?, chatModel?, systemModel? }`. Returns `{ compactionSummary, compactedMessageCount, lastCompactedId, tokensBefore, tokensAfter }` |
| `/api/chat/runs/active`             | GET    | List running/awaiting_user runs (excluding scheduled tasks). Returns `{ active, stale, unreadCount, awaitingAttentionCount }` — `unreadCount` covers scheduled runs too                                         |
| `/api/chat/runs/[messageId]/stream` | GET    | Re-attach to a run's event stream. Query params: `from=<seq>`, `chatId=<id>`. Returns SSE stream or `{"type":"gone"}`                                                                                           |
| `/api/chat/runs/resume`             | POST   | Resume a paused (`awaiting_user`) run. Body: `{ approvalId, response }` or `{ resumeMap: { approvalId: response, ... } }`                                                                                       |
| `/api/approvals/pending`            | GET    | List pending (unresolved) interrupt approvals. Query param: `chatId=<id>` (optional)                                                                                                                            |

## Chats & Messages

| Endpoint                    | Method     | Purpose                                                                                                                                                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/chats`                | GET        | List chats. Params: `limit`, `offset`, `q` (search), `pinned=1`, `scheduled=0/1`, `workspaceId`, `workspaceIds`. Returns `{ chats, total, totalMessages, limit, offset, hasMore }` |
| `/api/chats/[id]`           | GET/DELETE | Get or delete individual chat                                                                                                                                                      |
| `/api/chats/[id]/seen`      | POST       | Mark a chat's latest run as viewed. Returns `{ historyCount }`                                                                                                                     |
| `/api/chats/search`         | GET        | Dedicated full-text search across chat content                                                                                                                                     |
| `/api/messages/[messageId]` | GET/DELETE | Get or delete individual message                                                                                                                                                   |

## Configuration & Models

| Endpoint      | Method | Purpose                       |
| ------------- | ------ | ----------------------------- |
| `/api/config` | GET    | Server configuration          |
| `/api/models` | GET    | Available models per provider |
| `/api/tools`  | GET    | Available tool listing        |

## Suggestions & Autocomplete

| Endpoint            | Method | Purpose                                                                                                           |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `/api/suggestions`  | POST   | Generate follow-up suggestions. Body: `{ chatHistory: [{role,content}][], chatModel?, selectedSystemPromptIds? }` |
| `/api/autocomplete` | GET    | Browser autocomplete passthrough. Param: `q`. Returns OpenSearch suggestions JSON                                 |

## System Prompts

| Endpoint                   | Method     | Purpose                               |
| -------------------------- | ---------- | ------------------------------------- |
| `/api/system-prompts`      | GET/POST   | List or create persona/system prompts |
| `/api/system-prompts/[id]` | PUT/DELETE | Update or delete a prompt             |

## Uploads

| Endpoint                        | Method | Purpose                                                                               |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `/api/uploads/images`           | POST   | Upload images (multipart form). Returns `{ images: [{imageId, fileName, mimeType}] }` |
| `/api/uploads/images/[imageId]` | GET    | Serve uploaded image (validates hex-only ID)                                          |
| `/api/uploads`                  | POST   | Generic file upload                                                                   |

## Search Helpers

| Endpoint      | Method | Purpose      |
| ------------- | ------ | ------------ |
| `/api/images` | POST   | Image search |
| `/api/videos` | POST   | Video search |

## Workspaces

| Endpoint                              | Method         | Purpose                                                                                                                        |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/api/workspaces`                     | GET/POST       | List (param: `archived=true`) or create workspaces. POST body: `{ name, ...opts }`. Returns `{ workspaces }` / `{ workspace }` |
| `/api/workspaces/[id]`                | GET/PUT/DELETE | Get, update, or delete a workspace                                                                                             |
| `/api/workspaces/[id]/archive`        | POST           | Archive a workspace                                                                                                            |
| `/api/workspaces/[id]/unarchive`      | POST           | Unarchive a workspace                                                                                                          |
| `/api/workspaces/[id]/files`          | GET/POST       | List or upload workspace files                                                                                                 |
| `/api/workspaces/[id]/files/[fileId]` | GET/PUT/DELETE | Get, update, or delete a workspace file. PUT body: `{ content, expectedSha }` — see below                                      |
| `/api/workspaces/[id]/system-prompts` | GET            | List system prompts scoped to a workspace                                                                                      |

Writing a file is a compare-and-swap: `PUT` **requires** `expectedSha` (the sha the
edit was based on; `400` without it). If the row has moved on, the write is rejected
with `409` and `{ error, currentSha }` rather than clobbering the newer version — the
editor renders a conflict banner and the agent maps it onto its `stale_state` error.

## Artifacts

| Endpoint                  | Method | Purpose                                                                                                                     |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `/api/artifacts`          | GET    | List artifacts (metadata only). Requires `chatId` **or** `workspaceId`                                                      |
| `/api/artifacts/[id]`     | GET    | One artifact plus its version list (no content)                                                                             |
| `/api/artifacts/[id]`     | DELETE | Delete a **workspace** document and its versions. `400` for a chat-scoped artifact                                          |
| `/api/artifacts/[id]/raw` | GET    | Serve one version's HTML. Params: `version` (default latest), `download=1`. The only route emitting `text/html` — see below |

`raw` is the security boundary: it responds with a CSP carrying `sandbox` (no
`allow-same-origin`) and `default-src 'none'` with no `connect-src`, so the document
gets an opaque origin and no network at all. The sandbox rides the response rather
than only the viewer's iframe because the same bytes are reachable top-level.
`download=1` injects the network half as a `<meta>` tag so the exported file stays
inert. A chat-scoped artifact has no standalone DELETE — it dies with its chat. Only a workspace document, which outlives every chat that touched it, can be deleted on its own.

## Memories

| Endpoint                | Method         | Purpose                                                                                                                                                                          |
| ----------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/memories`         | GET            | List memories. Params: `q`, `category`, `workspaceId`, `sort` (`createdAt`/`lastAccessedAt`/`accessCount`), `limit`, `offset`. Returns `{ data, total, limit, offset, hasMore }` |
| `/api/memories`         | POST           | Create memory. Body: `{ content: string, workspaceId?: string }`. Returns created memory (201)                                                                                   |
| `/api/memories`         | DELETE         | Delete all memories                                                                                                                                                              |
| `/api/memories/[id]`    | GET/PUT/DELETE | Get, update, or delete a memory                                                                                                                                                  |
| `/api/memories/reindex` | POST           | Re-embed all memories (e.g., after embedding model change)                                                                                                                       |

## Skills

| Endpoint           | Method     | Purpose                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/skills`      | GET        | List skills. Params: `workspaceId` (includes global + workspace), `enabled=true` (only enabled). Returns array                                                                                                                                                                                                                 |
| `/api/skills`      | POST       | Create skill. Body: `{ name, description, content, workspaceId?, disableModelInvocation? }`. Returns skill (201). `409` on a reserved system-skill name, or a name already taken **in that exact scope** — a workspace skill may shadow a same-named global one                                                                |
| `/api/skills/[id]` | GET/DELETE | Get or delete a skill                                                                                                                                                                                                                                                                                                          |
| `/api/skills/[id]` | PUT        | Patch any subset of `{ name, description, content, workspaceId, enabled, disableModelInvocation }`. A rename and/or a `workspaceId` change move the row's `(name, scope)` identity — `409` if the destination pair is taken, or if the new name is a reserved system-skill name. `workspaceId: null` moves the skill to global |

## Workflows & Schedules

Reusable parameterized prompts (workflow) + saved cron fill-sets (schedule). See the Workflows section of the root `CLAUDE.md`.

| Endpoint                        | Method           | Purpose                                                                                                                                                                                              |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/workflows`                | GET              | List workflows (with `running: bool`)                                                                                                                                                                |
| `/api/workflows`                | POST             | Create workflow. Required: `name, prompt, chatModel`. Optional: `description, icon, focusMode, systemModel, selectedSystemPromptIds, selectedMethodologyId`. Rejects `400` on any prompt parse error |
| `/api/workflows/[id]`           | GET/PATCH/DELETE | Get, update (re-parses; auto-disables invalidated child schedules), or delete (cascades schedules, nulls chat provenance)                                                                            |
| `/api/workflows/[id]/run`       | POST             | Manual run. Body `{ values }`; substitutes + re-validates required inputs (`400 { missing }`), seeds a continuable chat, returns `{ chatId }` (201)                                                  |
| `/api/workflows/[id]/schedules` | GET/POST         | List/create schedules for a workflow. POST validates cron + fill-set completeness (`400 { missing }`)                                                                                                |
| `/api/schedules`                | GET              | List all schedules joined to workflow name (with `running: bool`)                                                                                                                                    |
| `/api/schedules/[id]`           | GET/PATCH/DELETE | Get, update (re-validates fill-set, reschedules cron), or delete (keeps past run chats, nulls `scheduleId`)                                                                                          |
| `/api/schedules/[id]/run`       | POST             | Run-now: fire a schedule immediately (headless). Returns `{ chatId, status }`                                                                                                                        |

## Dashboard

| Endpoint                        | Method | Purpose                           |
| ------------------------------- | ------ | --------------------------------- |
| `/api/dashboard/process-widget` | POST   | Process/render a dashboard widget |

## MCP Servers

| Endpoint                          | Method           | Purpose                                                                                     |
| --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `/api/mcp/servers`                | GET/POST         | List or create MCP servers. Secrets redacted; `hasToken`/`hasSecret` booleans returned      |
| `/api/mcp/servers/[id]`           | GET/PATCH/DELETE | Get, update, or delete a server                                                             |
| `/api/mcp/servers/[id]/test`      | POST             | Test connection (no cache side-effects). Returns `{ status, toolCount, toolNames, error? }` |
| `/api/mcp/servers/[id]/tools`     | GET              | Return cached tool descriptors for the server                                               |
| `/api/mcp/servers/[id]/authorize` | POST             | Start OAuth flow. Returns `{ authorizationUrl }` or `{ alreadyAuthorized: true }`           |
| `/api/mcp/oauth/callback`         | GET              | OAuth callback handler. Sends origin-pinned postMessage to opener on success/failure        |

## Other

| Endpoint           | Method | Purpose                                                    |
| ------------------ | ------ | ---------------------------------------------------------- |
| `/api/respond-now` | POST   | Soft-stop / early synthesis trigger. Body: `{ messageId }` |
| `/api/opensearch`  | GET    | OpenSearch description XML for browser search integration  |

## Data Flow

```
User → POST /api/chat
  → Idempotency check (getRun): if live run exists, re-subscribe
  → Resolve workspace (from chat record, fallback to body.workspaceId)
  → If workspace.modelOverride: overwrite body.chatModel/systemModel/imageCapable
  → resolveChatAndEmbedding() → chatLlm, systemLlm, embedding
  → Memory retrieval (if memoryEnabled)
  → handleHistorySave() — persists user message to DB
  → resolveSkillsForChat() + persistToolContextRow() for invoked skills
  → buildHistoryFromDb() (with compaction support via compactionRows)
  → new SimplifiedAgent(...) + startRun() + attachRunHost()
  → handler.searchAndAnswer() [fire-and-forget via LangGraph React Agent]
  → subscribe(run, 0, req.signal) → SSE stream to client
```

**Backgrounded runs**: A run persists in the DB even if the client disconnects. The client reconnects via `GET /api/chat/runs/[messageId]/stream?from=<seq>` to replay missed events.

**Interrupts**: When the agent needs human approval (file edit, code execution, user question), the run pauses (`awaiting_user`). The client resumes via `POST /api/chat/runs/resume`.

## Model Routing

If `systemModel` is omitted, falls back to `chatModel`. Both support `contextWindowSize`. `selectedSystemPromptIds` is treated as persona prompt IDs (despite the legacy name).

A workspace can pin its own chat/system model (`workspaces.modelOverride`, set via Workspace Settings). When present, the server overwrites the request's `chatModel`/`systemModel`/`imageCapable` before resolution — the client-sent values are discarded, so a stale client or direct API call can't bypass the pin. An unresolvable pinned model is a 400 with a workspace-specific message rather than the generic "Invalid model" error.
