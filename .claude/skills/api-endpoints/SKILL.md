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
  history: [string, string][]; // [human, ai] message pairs
  files: string[];       // Attached file references
  chatModel: { provider: string; name: string };
  systemModel?: { provider: string; name: string };
  embeddingModel: { provider: string; name: string };
  selectedSystemPromptIds: string[];
  messageImageIds?: string[];   // Image attachment IDs
  messageImages?: Array<{ imageId: string; fileName: string; mimeType: string }>;
  userLocation?: string;        // When location toggle enabled
  userProfile?: string;         // When about-me toggle enabled
  selectedToolIds?: string[];   // Tool whitelist
}
```

**Response**: Streaming JSON lines:

```
{"type":"init","data":{"chatId":"...","messageId":"..."}}
{"type":"response","data":"token text"}
{"type":"tool_call_started","data":{...}}
{"type":"tool_call_success","data":{...}}
{"type":"sources","data":[...]}
{"type":"modelStats","data":{"inputTokens":...,"outputTokens":...}}
{"type":"end"}
```

## Other Endpoints

| Endpoint                        | Method     | Purpose                                                                             |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `/api/uploads/images`           | POST       | Upload images (multipart form, returns `{images: [{imageId, fileName, mimeType}]}`) |
| `/api/uploads/images/[imageId]` | GET        | Serve uploaded image (validates hex-only ID)                                        |
| `/api/config`                   | GET        | Server configuration                                                                |
| `/api/models`                   | GET        | Available models per provider                                                       |
| `/api/chats`                    | GET/DELETE | Chat history CRUD                                                                   |
| `/api/chats/[chatId]`           | GET/DELETE | Individual chat operations                                                          |
| `/api/suggestions`              | POST       | Auto-suggestion generation                                                          |
| `/api/system-prompts`           | GET/POST   | System prompt management                                                            |
| `/api/system-prompts/[id]`      | PUT/DELETE | Individual prompt operations                                                        |
| `/api/tools`                    | GET        | Available tool listing                                                              |
| `/api/respond-now`              | POST       | Soft-stop / early synthesis trigger                                                 |
| `/api/images`                   | POST       | Image search helper                                                                 |
| `/api/videos`                   | POST       | Video search helper                                                                 |

## Data Flow

```
User → POST /api/chat
  → Construct Chat LLM + System LLM from model specs
  → new SimplifiedAgent(...) + handler.searchAndAnswer()
    → LangGraph React Agent with tools (Chat LLM for reasoning)
    → Tools use System LLM via config.configurable.systemLlm
    → agent.streamEvents() → emitter events → TransformStream → JSON lines
  → ChatWindow reads stream → messageHandler() dispatches to UI
```

## Model Routing

If `systemModel` is not specified in the request, it falls back to the Chat Model. See AGENTS.md Architecture section for model role definitions.
