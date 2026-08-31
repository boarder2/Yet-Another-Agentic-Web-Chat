---
name: yaawc-api-endpoints
description: Generic HTTP route conventions and /api/chat run flow; defer subsystem routes to their specialized skills.
---

# API Endpoints & Data Flow

## Chat Endpoint (`POST /api/chat`)

**Source**: `src/app/api/chat/route.ts`

```typescript
{
  message: { messageId: string; chatId: string; content: string };
  focusMode: string;     // "webSearch" | "localResearch" | "chat"
  files: string[];
  chatModel: { provider: string; name: string; contextWindowSize?: number; reasoningEffort?: ReasoningEffort };
  systemModel?: { provider: string; name: string; contextWindowSize?: number; reasoningEffort?: ReasoningEffort };
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
  → validate model refs → resolveChatAndEmbedding() → request-local effective Chat/System refs + chatLlm, systemLlm, embedding
  → memory retrieval → handleHistorySave() → resolveSkillsForChat()
  → buildHistoryFromDb() (compaction-aware)
  → new SimplifiedAgent + startRun() + attachRunHost() → searchAndAnswer() (fire-and-forget)
  → subscribe(run, 0, req.signal) → stream to client
```

If `systemModel` is omitted it falls back to the complete Chat reference, including effective reasoning effort. Malformed effort values return HTTP 400; valid stale values resolve against current capabilities without rewriting durable definitions. Backgrounded runs persist; clients reconnect via the stream route below. Interrupts pause the run (`awaiting_user`); resume via `/api/chat/runs/resume`.

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

## Subsystem Routes

Domain skills own their route contracts and failure semantics:

- `/api/workspaces/*` — `yaawc-workspace-files`
- `/api/artifacts/*` — `yaawc-artifacts`
- `/api/workflows/*`, `/api/schedules/*` — `yaawc-automation`
- `/api/skills/*` — `yaawc-runtime-skills`
- `/api/dashboard/*` — `yaawc-dashboard-widgets`
- `/api/mcp/*` — `yaawc-mcp-integration`
- `/api/uploads/images/*` — `yaawc-image-attachments`
- `/api/settings` — `yaawc-settings-persistence`

Memory routes remain generic CRUD under `/api/memories/*`; preserve scoped filtering, paging, wipe-all semantics, and `/reindex` behavior.

## Adding a route

Use Next.js App Router named `GET`/`POST`/`PATCH`/`PUT`/`DELETE` exports. Parse and validate at the boundary, return structured JSON errors with the established status code, and keep domain logic in `src/lib/` rather than the route. Streaming responses use `TransformStream` and the existing typed NDJSON/SSE vocabulary.

For UI callers, add a TanStack Query hook under `src/lib/hooks/api/` using `apiFetch` and keys from `qk`; mutations invalidate their owned keys. Add the lowest-level test that proves the route boundary.

## Conventions

- Export named HTTP method functions; catch expected failures and return structured `NextResponse.json()` errors.
- Never expose secrets or unscoped rows in response payloads.
- Streaming endpoints use `TransformStream` plus typed JSON lines; the chat vocabulary belongs to `yaawc-streaming-events`.
