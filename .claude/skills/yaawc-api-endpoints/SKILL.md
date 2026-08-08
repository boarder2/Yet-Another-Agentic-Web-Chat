---
name: yaawc-api-endpoints
description: Use when adding, modifying, or debugging API routes, request/response schemas, or the chat route handler.
---

# API Endpoints & Data Flow

## Chat Endpoint (`POST /api/chat`)

**Source**: `src/app/api/chat/route.ts`

```typescript
{
  message: { messageId: string; chatId: string; content: string };
  focusMode: string;     // "webSearch" | "localResearch" | "chat"
  files: string[];
  chatModel: { provider: string; name: string; contextWindowSize?: number };
  systemModel?: { provider: string; name: string; contextWindowSize?: number };
  // Embedding model is NOT sent — resolved server-side from app_settings
  selectedSystemPromptIds: string[];  // persona prompt IDs (legacy name)
  selectedMethodologyId?: string;
  messageImageIds?: string[];
  messageImages?: Array<{ imageId: string; fileName: string; mimeType: string }>;
  // userLocation/userProfile/memory flags are server-authoritative (read from
  // app_settings, client values overwritten); private sessions strip them
  isPrivate?: boolean;
  workspaceId?: string | null;
  imageCapable?: boolean;
  invokedSkills?: string[];
  panel?: PanelConfig;   // see yaawc-agent-panel
}
```

**Idempotency**: if `message.messageId` already has a live run (`running`/`awaiting_user`), the request re-subscribes instead of starting a duplicate.

**Response**: NDJSON stream of typed `StreamEvent`s — the full vocabulary (types, payloads, `messageEnd`, `gone`) is owned by `yaawc-streaming-events`.

### Data flow

```
POST /api/chat
  → idempotency check (getRun) → re-subscribe if live
  → resolve workspace; workspace.modelOverride overwrites body models (server-side pin —
    unresolvable pinned model = 400 with workspace-specific message)
  → resolveChatAndEmbedding() → chatLlm, systemLlm, embedding
  → memory retrieval → handleHistorySave() → resolveSkillsForChat()
  → buildHistoryFromDb() (compaction-aware)
  → new SimplifiedAgent + startRun() + attachRunHost() → searchAndAnswer() (fire-and-forget)
  → subscribe(run, 0, req.signal) → stream to client
```

If `systemModel` is omitted it falls back to `chatModel`. Backgrounded runs persist; clients reconnect via the stream route below. Interrupts pause the run (`awaiting_user`); resume via `/api/chat/runs/resume`.

## Run Management

| Endpoint                            | Method | Purpose                                                                                                                |
| ----------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `/api/chat/cancel`                  | POST   | Hard-cancel. `{ messageId }`                                                                                           |
| `/api/chat/compact`                 | POST   | Summarize history. `{ chatId, instructions?, chatModel?, systemModel? }` → `{ compactionSummary, tokensBefore/After }` |
| `/api/chat/runs/active`             | GET    | Running/awaiting runs → `{ active, stale, unreadCount, awaitingAttentionCount }`                                       |
| `/api/chat/runs/[messageId]/stream` | GET    | Re-attach to a run. `from=<seq>`, `chatId` → NDJSON stream or `{"type":"gone"}`                                        |
| `/api/chat/runs/resume`             | POST   | Resume paused run. `{ approvalId, response }` or `{ resumeMap }`                                                       |
| `/api/approvals/pending`            | GET    | Pending interrupt approvals. `?chatId=`                                                                                |

## Chats, Messages, Config

| Endpoint                     | Method           | Purpose                                                                                                       |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `/api/chats`                 | GET              | List. `limit`, `offset`, `q`, `pinned=1`, `scheduled=0/1`, `workspaceId(s)` → `{ chats, total, hasMore, … }`  |
| `/api/chats/[id]`            | GET/PATCH/DELETE | One chat; PATCH renames (locks title against auto-regeneration)                                               |
| `/api/chats/[id]/seen`       | POST             | Mark latest run viewed → `{ historyCount }`                                                                   |
| `/api/chats/search`          | GET              | Full-text search                                                                                              |
| `/api/messages/[messageId]`  | GET              | One message                                                                                                   |
| `/api/config`                | GET              | Server configuration                                                                                          |
| `/api/models`                | GET              | Available models per provider                                                                                 |
| `/api/tools`                 | GET              | Tool listing                                                                                                  |
| `/api/suggestions`           | POST             | Follow-ups. `{ chatHistory, chatModel?, selectedSystemPromptIds? }`                                           |
| `/api/autocomplete`          | GET              | OpenSearch suggestions. `?q=`                                                                                 |
| `/api/system-prompts(/[id])` | CRUD             | Persona/methodology prompts                                                                                   |
| `/api/uploads/images(/[id])` | POST/GET         | Upload (multipart) / serve images — see `yaawc-image-attachments`                                             |
| `/api/uploads`               | POST             | Document upload for file search: extract → chunk → embed → `{ files: [{ fileName, fileExtension, fileId }] }` |
| `/api/tts(/stream)`          | GET/POST         | Voice list / speech synthesis (Kokoro, `mode: read\|narrate` — narrate LLM-rewrites and caches per message)   |
| `/api/images`, `/api/videos` | POST             | Image / video search                                                                                          |
| `/api/respond-now`           | POST             | Soft-stop / early synthesis. `{ messageId }`                                                                  |
| `/api/opensearch`            | GET              | OpenSearch description XML                                                                                    |

## Workspaces

| Endpoint                                | Method           | Purpose                                                      |
| --------------------------------------- | ---------------- | ------------------------------------------------------------ |
| `/api/workspaces`                       | GET/POST         | List (`archived=true`) / create                              |
| `/api/workspaces/[id]`                  | GET/PATCH/DELETE | CRUD; `/archive` + `/unarchive` POST sub-routes              |
| `/api/workspaces/[id]/files(/[fileId])` | CRUD             | Files. PUT `{ content, expectedSha }` — CAS write, see below |
| `/api/workspaces/[id]/system-prompts`   | GET              | Workspace-scoped prompts                                     |

File PUT is a compare-and-swap: `expectedSha` required (`400` without); a stale sha gets `409` + `{ error, currentSha }` — the editor shows a conflict banner, the agent maps it to `stale_state`.

## Artifacts

| Endpoint                  | Method     | Purpose                                                                         |
| ------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `/api/artifacts`          | GET        | List metadata. Requires `chatId` **or** `workspaceId`                           |
| `/api/artifacts/[id]`     | GET/DELETE | One + versions (no content). DELETE workspace docs only — `400` for chat-scoped |
| `/api/artifacts/[id]/raw` | GET        | Serve one version's HTML. `version`, `download=1`                               |

`raw` is the security boundary — the only route emitting `text/html`; its response CSP carries `sandbox` (no `allow-same-origin`) and `default-src 'none'` (no network), because the same bytes are reachable top-level where an iframe attribute wouldn't apply. `download=1` injects the network half as a `<meta>` tag.

## Memories & Skills

| Endpoint               | Method | Purpose                                                                                                                                                                                                           |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/memories(/[id])` | CRUD   | List (`q`, `category`, `workspaceId`, `sort`, paging) / create / update / delete; DELETE on collection wipes all; `/reindex` re-embeds                                                                            |
| `/api/skills(/[id])`   | CRUD   | List (`workspaceId`, `enabled=true`) / create / patch / delete. `409` on reserved names or `(name, scope)` collisions — a workspace skill may shadow a same-named global one; `workspaceId: null` moves to global |

## Workflows & Schedules

| Endpoint                        | Method           | Purpose                                                                                                                                                                            |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/workflows(/[id])`         | CRUD             | POST requires `name, prompt, chatModel`; `400` on prompt parse error. PATCH re-parses, auto-disables invalidated child schedules. DELETE cascades schedules, nulls chat provenance |
| `/api/workflows/[id]/run`       | POST             | Manual run. `{ values }`; `400 { missing }` on incomplete inputs → `{ chatId }` (201)                                                                                              |
| `/api/workflows/[id]/schedules` | GET/POST         | Schedules for a workflow; POST validates cron + fill-set                                                                                                                           |
| `/api/schedules(/[id])`         | GET/PATCH/DELETE | PATCH re-validates + reschedules; DELETE keeps past run chats, nulls `scheduleId`; `/[id]/run` fires now                                                                           |

## Other Subsystem Routes

- `/api/dashboard/*` — see `yaawc-dashboard-widgets`
- `/api/mcp/*` — see `yaawc-mcp-integration`
- `/api/settings` — see `yaawc-settings-persistence`

## Conventions

- Export named HTTP method functions; try/catch with structured error JSON via `NextResponse.json()`
- Streaming endpoints use `TransformStream` + JSON lines (see chat route)
