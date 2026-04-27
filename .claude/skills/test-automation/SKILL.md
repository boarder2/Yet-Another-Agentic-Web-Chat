---
name: test-automation
description: Use when testing or verifying changes, running the dev server, static analysis, curl API checks, playwright browser automation, or end-to-end validation.
---

# Test Automation

No formal test framework. Verify via LSP diagnostics, `curl`, and `playwright-cli` against a running dev server.

## Prerequisites

1. `yarn dev`
2. Wait until `curl -s http://localhost:3000/api/config` returns JSON.
3. Configure models via the Settings page or localStorage before testing LLM-dependent features.

## Static Analysis

Use the LSP tool for type and lint diagnostics on edited files.

## API Testing with curl

**Chat endpoint payload shape:**

```bash
curl -s -m 120 -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "message": {"messageId":"test-1","chatId":"test-1","content":"Hello"},
    "focusMode": "chat",
    "history": [],
    "files": [],
    "chatModel": {"provider":"<provider>","name":"<model>"},
    "embeddingModel": {"provider":"<provider>","name":"<model>"},
    "selectedSystemPromptIds": []
  }' | head -20
```

Key points:

- `Body.message` requires `{messageId, chatId, content}` (not a plain string).
- Search endpoint takes `query` as a top-level string; supports `"stream": true`.
- Valid focus modes: `webSearch`, `localResearch`, `chat`.
- Use `head -N` or `--max-time` to avoid hanging on streaming endpoints.
- Check the dev-server terminal for backend errors.

## UI Testing

Use the **playwright-cli** skill for browser automation. Run headed (`--headed` / `--no-headless`) when testing so you can observe the session.

Project-specific notes:

- Files passed to `setInputFiles` must be within the workspace root.
- Sleep between send and snapshot to wait for LLM responses.
- After clicking a focus mode button, check the snapshot heading to confirm the active mode.

## Creating Test Images

```bash
python3 -c "
import struct, zlib
def png(w,h,color):
    raw = b''.join(b'\x00'+bytes(color)*w for _ in range(h))
    c = zlib.compress(raw)
    def chunk(t,d): n=len(d); return struct.pack('>I',n)+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',c)+chunk(b'IEND',b'')
open('/tmp/blue-test.png','wb').write(png(100,100,(0,0,255)))
"
```

Or capture one with `playwright-cli screenshot`.

## Debugging Tips

- **0 tokens / "No valid response found"**: Verify `langgraph_node` values in event filtering match the agent framework version. `langchain`'s `createAgent` uses node name `model_request` (not `agent`).
- **Parse errors after editing**: Check LSP diagnostics.
- **Server logs**: Dev-server terminal shows request logs, agent init, tool usage, and errors.
- **Direct LLM test**: If the agent misbehaves, hit the provider directly with `curl` to isolate LangChain vs provider.
