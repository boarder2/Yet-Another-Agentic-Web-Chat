---
name: yaawc-mcp-integration
description: Remote MCP server auth, transport, tool injection, approvals, workspace scope, APIs, and settings UI.
---

# MCP Integration

Remote MCP servers whose tools inject into every tool-running focus mode. Per tool: exposed or not, and approval-gated (default) or auto-run.

## DB (`src/lib/db/schema.ts`)

Tables: `mcpServers`, `mcpServerWorkspaces`, `mcpOauth`, `mcpOauthFlows`; `approvalRequests.toolKind` includes `'mcp_tool'`.

- `mcpServers`: `authType` (`none|bearer|oauth_client_credentials|oauth`), `transport` (`auto|streamableHttp|sse`), `status`. `secretToken`/`oauthClientSecret`/`extraHeaders` encrypted at rest (AES-256-GCM): routes `encrypt()` on write, `decryptServerSecrets()` on every read path. `mcpOauth.tokens`/`clientInformation`/`discoveryState` are encrypted JSON blobs handled in `oauth.ts` (`encryptJson`/`decryptJson` — plain `text()` columns, encryption sits above the JSON layer). `migrateMcpAuth()` encrypts legacy plaintext rows at boot (idempotent).
- `toolConfig` JSON: `Record<toolName, { enabled?; approval?: 'always'|'never' }>` — only overrides stored; absent = **enabled + always ask** (`resolveToolSetting()`), so it degrades gracefully as tool lists change. Stale keys are never pruned; a same-named tool that reappears re-inherits its override.
- Scoping: `mcpServerWorkspaces` (join, cascade delete) + `visibleInGeneralChat` (default false). Empty scope = available everywhere; non-empty = only those workspaces' chats, plus unscoped chats when the flag is set. `isServerVisibleForChat()` in `types.ts` is the single decision function.

## Library (`src/lib/mcp/`)

- `types.ts` — row/descriptor types, `serverNameSlug()`, `buildNamespacedName()`, `resolveToolSetting()`, `redactServer()`, `decryptServerSecrets()`, `isServerVisibleForChat()`, `buildRequestInit()`, and the MCP-compatible `validateExtraHeaders()` wrapper
- `client.ts` — `connectMcpServer(server)`: decrypts, handles none/bearer/auto inline; delegates OAuth variants to `oauth.ts`
- `manager.ts` — module-scoped connection cache; `getToolDescriptorsForEnabledServers()` (stale-while-revalidate, parallel, 3s/server timeout, 100-tool cap); `getEnabledServerToolConfigs()` + `getServerWorkspaceScopes()` (fresh per turn); `callMcpTool()`, `testMcpServerConnection()`, `invalidateServer()`
- `oauth.ts` — DB-backed provider classes; discovery/token fetch/401 re-fetch all handled by the SDK's `auth()`, no manual token plumbing
- `workspaceScopes.ts` — `listScopedWorkspaceIds`/`setScopedWorkspaceIds` (transactional full-replace, so an invalid workspace id fails the whole update)
- `toolFactory.ts` — `buildMcpLangchainTools({ workspaceId, … })`: applies `toolConfig` (skips disabled; auto-run skips `interrupt()`) and scope filtering; MCP JSON Schema passes straight to LangChain `tool()` (no Zod conversion); `buildToolForDescriptor(…)` reconstructs an already-approved tool on resume regardless of current scope (`_descriptorSnapshot` in the payload)

Tool naming: `mcp__{serverSlug}__{toolName}` — the `mcp__` prefix is the correlation key in `handleToolStart`.

## Injection & approval

Chat route merges MCP tools into `extraTools` before both `searchAndAnswer` call sites, passing the chat's resolved `workspaceId`; `doResume()` rebuilds the same way. Approval uses LangGraph `interrupt()` with `kind: 'mcp_tool'` (skipped for auto-run); the payload carries `serverId` so the frontend knows which server to patch. **"Always allow"** resumes normally AND fires `persistMcpAlwaysAllow()` — one `toolConfigPatch` PATCH setting `approval='never'` (atomic server-side merge via SQLite `json_patch`; no GET, nothing threads through the resume engine). UI: `McpToolApproval.tsx`; events `mcp_tool_pending`/`_answered` (see `yaawc-streaming-events`).

## API (`src/app/api/mcp/`)

`servers/` GET/POST · `servers/[id]/` GET/PATCH/DELETE (secrets redacted — `hasToken`/`hasSecret`; PATCH accepts `toolConfigPatch` and `extraHeadersPatch`, merged atomically via `json_patch`, `null` deletes a key; also `visibleInGeneralChat`) · `servers/[id]/test` POST (no cache side-effects) · `servers/[id]/tools` GET (cached descriptors) · `servers/[id]/authorize` POST (`{ authorizationUrl }` or `{ alreadyAuthorized }`) · `servers/[id]/workspaces` GET/PUT (full-replace scope; 400 on unknown workspace id) · `oauth/callback` GET (timing-safe state compare, deletes flow row **after** `finishAuth` succeeds, origin-pinned postMessage — never `'*'`).

Hooks: `src/lib/hooks/api/useMcpServers.ts` + `useMcpServerWorkspaceScopes.ts`; keys under `qk.mcpServer*`.

## Extra headers

`extraHeaders` is a JSON `Record<string,string>` for a second credential beyond `authType`. Each **value** is encrypted individually (`encryptHeaderValues`) so the JSON structure stays visible to SQLite — PATCH can merge one header atomically instead of forcing the user to retype every secret. The shared `src/lib/http/secretHeaders.ts` owns bounded validation, encryption, decryption, and redaction-name handling; `types.ts` preserves MCP's existing wrapper and field names. `buildRequestInit(server)` merges bearer + extra headers (extra wins) at **every** transport construction site in `client.ts` and `oauth.ts`. `validateExtraHeaders` enforces RFC 7230 token names, no CR/LF/NUL, entry cap. `redactServer()` returns `extraHeaderNames` only — values never leave the server.

## Settings UI

`McpServersSection` (`src/app/settings/sections/`). Per server: `ToolsPanel` (lazy-mounted; per-tool enabled + auto-run `AppSwitch`es PATCHing `toolConfig`; only discovered tools render) and `WorkspaceScopePanel` (checkbox list merging active + archived workspaces — scoped-but-archived must still show; immediate full-array save; "visible in general chat" switch appears once ≥1 workspace checked). Collapsed badge: "All workspaces" / "Scoped: n".

## Gotchas

- `auto` transport probes StreamableHTTP then SSE — but NEVER falls back on `UnauthorizedError`.
- Extra-header values are write-only in the UI: the form diffs against `extraHeaderNames`, sends only typed values + `null` for removals. Blank on an existing header = "keep", never "clear".
- OAuth `redirectToAuthorization` captures the URL in `capturedAuthUrl`; the callback uses a fresh transport instance.
