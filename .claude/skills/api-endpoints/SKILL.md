---
name: api-endpoints
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
  embeddingModel: { provider: string; name: string };
  selectedSystemPromptIds: string[];  // Persona prompt IDs (legacy name)
  selectedMethodologyId?: string;
  messageImageIds?: string[];
  messageImages?: Array<{ imageId: string; fileName: string; mimeType: string }>;
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
{"type":"context_grew","kind":"...","tokens":...,"totalEstimated":...,"messageId":"..."}
{"type":"workspace_file_changed","data":{...},"messageId":"..."}
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
| `/api/chat/runs/active`             | GET    | List running/awaiting_user runs (excluding scheduled tasks). Returns `{ active, stale, unreadCount, awaitingAttentionCount }`                                                                                   |
| `/api/chat/runs/[messageId]/stream` | GET    | Re-attach to a run's event stream. Query params: `from=<seq>`, `chatId=<id>`. Returns SSE stream or `{"type":"gone"}`                                                                                           |
| `/api/chat/runs/resume`             | POST   | Resume a paused (`awaiting_user`) run. Body: `{ approvalId, response }` or `{ resumeMap: { approvalId: response, ... } }`                                                                                       |
| `/api/approvals/pending`            | GET    | List pending (unresolved) interrupt approvals. Query param: `chatId=<id>` (optional)                                                                                                                            |

## Chats & Messages

| Endpoint                    | Method     | Purpose                                                                                                                                                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/chats`                | GET        | List chats. Params: `limit`, `offset`, `q` (search), `pinned=1`, `scheduled=0/1`, `workspaceId`, `workspaceIds`. Returns `{ chats, total, totalMessages, limit, offset, hasMore }` |
| `/api/chats/[id]`           | GET/DELETE | Get or delete individual chat                                                                                                                                                      |
| `/api/chats/[id]/seen`      | POST       | Mark a chat's latest run as viewed. Returns `{ historyCount, scheduledCount }`                                                                                                     |
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
| `/api/workspaces/[id]/files/[fileId]` | GET/PUT/DELETE | Get, update, or delete a workspace file                                                                                        |
| `/api/workspaces/[id]/system-prompts` | GET            | List system prompts scoped to a workspace                                                                                      |
| `/api/workspaces/[id]/urls`           | GET/POST       | Manage workspace URL sources                                                                                                   |
| `/api/workspaces/[id]/urls/check`     | POST           | Validate a URL                                                                                                                 |

## Memories

| Endpoint                | Method         | Purpose                                                                                                                                                                          |
| ----------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/memories`         | GET            | List memories. Params: `q`, `category`, `workspaceId`, `sort` (`createdAt`/`lastAccessedAt`/`accessCount`), `limit`, `offset`. Returns `{ data, total, limit, offset, hasMore }` |
| `/api/memories`         | POST           | Create memory. Body: `{ content: string, workspaceId?: string }`. Returns created memory (201)                                                                                   |
| `/api/memories`         | DELETE         | Delete all memories                                                                                                                                                              |
| `/api/memories/[id]`    | GET/PUT/DELETE | Get, update, or delete a memory                                                                                                                                                  |
| `/api/memories/reindex` | POST           | Re-embed all memories (e.g., after embedding model change)                                                                                                                       |

## Skills

| Endpoint           | Method         | Purpose                                                                                                          |
| ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/api/skills`      | GET            | List skills. Params: `workspaceId` (includes global + workspace), `enabled=true` (only enabled). Returns array   |
| `/api/skills`      | POST           | Create skill. Body: `{ name, description, content, workspaceId?, disableModelInvocation? }`. Returns skill (201) |
| `/api/skills/[id]` | GET/PUT/DELETE | Get, update, or delete a skill                                                                                   |

## Scheduled Tasks

| Endpoint                                  | Method         | Purpose                                                                                                                                                                                                                            |
| ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/scheduled-tasks`                    | GET            | List scheduled tasks (with `running: bool` field)                                                                                                                                                                                  |
| `/api/scheduled-tasks`                    | POST           | Create task. Required: `name, prompt, cronExpression, chatModel, embeddingModel`. Optional: `focusMode, systemModel, sourceUrls, selectedSystemPromptIds, selectedMethodologyId, timezone, enabled, retentionMode, retentionValue` |
| `/api/scheduled-tasks/[id]`               | GET/PUT/DELETE | Get, update, or delete a scheduled task                                                                                                                                                                                            |
| `/api/scheduled-tasks/[id]/run`           | POST           | Manually trigger a task run                                                                                                                                                                                                        |
| `/api/scheduled-tasks/[id]/runs`          | GET            | List run history for a task                                                                                                                                                                                                        |
| `/api/scheduled-tasks/runs`               | GET            | List all scheduled task runs                                                                                                                                                                                                       |
| `/api/scheduled-tasks/runs/[chatId]/view` | POST           | Mark a scheduled task run chat as viewed                                                                                                                                                                                           |
| `/api/scheduled-tasks/runs/unread`        | GET            | Count unread scheduled task runs                                                                                                                                                                                                   |

## Dashboard

| Endpoint                        | Method | Purpose                           |
| ------------------------------- | ------ | --------------------------------- |
| `/api/dashboard/process-widget` | POST   | Process/render a dashboard widget |

## Other

| Endpoint           | Method | Purpose                                                    |
| ------------------ | ------ | ---------------------------------------------------------- |
| `/api/respond-now` | POST   | Soft-stop / early synthesis trigger. Body: `{ messageId }` |
| `/api/opensearch`  | GET    | OpenSearch description XML for browser search integration  |

## Data Flow

```
User → POST /api/chat
  → Idempotency check (getRun): if live run exists, re-subscribe
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
