---
name: mcp-integration
description: Use when working on MCP (Model Context Protocol) remote server support — server CRUD, connection layer, OAuth/auth, tool injection, approval gating, or the MCP settings UI.
---

# MCP Integration

Allows connecting remote MCP servers so their tools become available to the agent. Tools from enabled servers are injected alongside workspace tools. Per tool, users choose whether it's exposed at all and whether each call asks for approval (default) or auto-runs.

## DB Schema (`src/lib/db/schema.ts`)

Three tables: `mcpServers`, `mcpOauth`, `mcpOauthFlows`. `approvalRequests.toolKind` enum includes `'mcp_tool'`.

`mcpServers` key columns: `authType` enum `['none','bearer','oauth_client_credentials','oauth']`, `transport` enum `['auto','streamableHttp','sse']`, `status` enum `['unknown','connected','auth_required','error','disabled']`, `secretToken`/`oauthClientSecret` are encrypted at-rest (store raw; drizzle handles it via `text()` — no additional encryption layer was added, keep secrets server-side only).

`toolConfig` JSON column: `Record<toolName, { enabled?: boolean; approval?: 'always'|'never' }>`. Keyed by tool name; absent entry / absent field = default (**enabled + always ask**), so it degrades gracefully as the tool list changes. Only overrides are stored. **Stale keys** (tools no longer offered) are never pruned — harmless and unread, but a same-named tool that reappears re-inherits the old override. `resolveToolSetting()` in `types.ts` applies the defaults.

## Library (`src/lib/mcp/`)

| File             | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`       | `McpServerRow`, `McpToolDescriptor`, `McpToolConfig`, `McpAuthRequiredError`, `serverNameSlug()`, `buildNamespacedName()`, `resolveToolSetting()`                                                                                                                                                                                                                                                                                               |
| `client.ts`      | `connectMcpServer(server)` — handles none/bearer/auto inline; delegates oauth_cc/oauth to `oauth.ts`                                                                                                                                                                                                                                                                                                                                            |
| `manager.ts`     | Module-scoped connection cache; `getToolDescriptorsForEnabledServers()` (stale-while-revalidate, parallel, 3s timeout per server, 50-tool cap); `getEnabledServerToolConfigs()` (fresh per turn); `callMcpTool()`, `testMcpServerConnection()`, `invalidateServer()`                                                                                                                                                                            |
| `oauth.ts`       | `McpDbOAuthProvider` (shared DB-backed token/discovery storage base); `McpOAuthProvider` (interactive auth-code) + `startOAuthAuthorization()`/`handleOAuthCallback()`/`connectWithOAuth()`; `McpClientCredentialsProvider` (no redirect → SDK runs client_credentials) + `connectWithClientCredentials()`. Discovery, token fetch/cache, basic-vs-post auth, and 401 re-fetch are all handled by the SDK's `auth()` — no manual token plumbing |
| `toolFactory.ts` | `buildMcpLangchainTools()` — applies `toolConfig` (skips disabled tools; auto-run tools skip the `interrupt()`); the MCP tool's JSON Schema is passed straight to LangChain `tool()` (no Zod conversion — `@langchain/core` validates JSON Schema natively); `buildToolForDescriptor(descriptor, opts, requiresApproval=true)`; `_descriptorSnapshot` in payload for doResume reconstruction                                                    |

## Tool naming

`mcp__{serverSlug}__{toolName}` — `buildNamespacedName()` in `types.ts`. All MCP tool names start with `mcp__`, used for correlation in `handleToolStart`.

## Agent injection (`src/app/api/chat/route.ts`)

MCP tools are built and merged into `extraTools` (alongside `workspaceExtraTools`) before both `searchAndAnswer` call sites. On resume, `doResume()` in `simplifiedAgent.ts` rebuilds MCP tools OUTSIDE the `if (this.workspaceId)` guard. Both `handleToolStart` blocks check `startsWith('mcp__')` to push `runId` for approval correlation.

## Approval flow

Uses LangGraph `interrupt()` with `kind: 'mcp_tool'` (skipped entirely for auto-run tools). The interrupt payload carries `serverId` (flows into the `mcp_tool_pending` event data via `{ ...payload }`) so the frontend write-through knows which server to patch. `runHost.ts` `ToolKind` union and `isRejection()` include `'mcp_tool'`. Frontend: `McpToolApproval.tsx` component; `ChatWindow.tsx` handles `mcp_tool_pending`/`mcp_tool_answered` events (both SSE copies, all 4 `_stale`/`_cancelled` locations, and the `/api/approvals/pending` switch — all three `PendingMcpApproval` construction sites carry `serverId`).

**"Always allow" write-through**: `McpToolApproval` shows an "Always allow" button (gated on `serverId`); `onMcpToolDecide(approvalId, approved, { alwaysAllow })` in `ChatWindow.tsx` resumes as normal AND calls `persistMcpAlwaysAllow()` — a single `toolConfigPatch` PATCH that sets `toolConfig[tool].approval = 'never'` (atomic server-side merge, no GET). No new fields thread through the resume engine. The terminal `error` event clears `pendingMcpApprovals` alongside the other approval buckets.

## API routes (`src/app/api/mcp/`)

| Route                            | Purpose                                                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `servers/` GET/POST              | List + create servers                                                                                                                                                                                                                                                 |
| `servers/[id]/` GET/PATCH/DELETE | CRUD; secrets are redacted in responses (`hasToken`/`hasSecret` booleans). PATCH accepts `toolConfigPatch` (validated partial; merged atomically server-side via SQLite `json_patch` — `null` value deletes a tool's entry); GET returns full `toolConfig` for the UI |
| `servers/[id]/test` POST         | Test connection (no cache side-effects)                                                                                                                                                                                                                               |
| `servers/[id]/tools` GET         | Return cached tool descriptors                                                                                                                                                                                                                                        |
| `servers/[id]/authorize` POST    | Start OAuth flow; returns `{ authorizationUrl }` or `{ alreadyAuthorized }`                                                                                                                                                                                           |
| `oauth/callback` GET             | OAuth callback — timing-safe state compare, `finishAuth()`, deletes flow row after success, origin-pinned postMessage                                                                                                                                                 |

## TanStack Query hooks (`src/lib/hooks/api/useMcpServers.ts`)

`useMcpServersList`, `useMcpServer`, `useMcpServerTools`, `useCreateMcpServer`, `usePatchMcpServer`, `useDeleteMcpServer`, `useTestMcpServer`, `useAuthorizeMcpServer` (opens popup + listens for postMessage). Query keys in `src/lib/api/keys.ts` under `qk.mcpServers`, `qk.mcpServer(id)`, `qk.mcpServerTools(id)`.

## Settings UI

`McpServersSection` at `src/app/settings/sections/McpServersSection.tsx`; section key `'mcp-servers'` in `src/app/settings/types.ts`. Each server row has an expandable `ToolsPanel` (mounted lazily so `useMcpServerTools` only fetches when opened) listing currently-discovered tools, each with two `AppSwitch`es: enabled, and auto-run (off = ask every time; disabled when the tool is off). Edits PATCH `toolConfig`. Only discovered tools render, so stale keys never show. `AppSwitch` forwards `aria-label`/`disabled`.

## Key gotchas

- `auto` transport probes StreamableHTTP first, falls back to SSE — but NEVER falls back on `UnauthorizedError`.
- OAuth `redirectToAuthorization` captures the URL in `capturedAuthUrl` (caller reads it); callback uses a fresh transport instance.
- OAuth flow row is deleted AFTER `finishAuth` succeeds (not before — plan C1).
- `postMessage` in callback uses `event.origin !== window.location.origin` guard (never `'*'`).
