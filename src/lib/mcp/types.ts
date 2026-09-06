import { createHash } from 'crypto';

import type { mcpServers, mcpOauth } from '@/lib/db/schema';
import { decryptTolerant } from '@/lib/encryption';
import {
  decryptHeaderValues,
  getSecretHeaderNames,
  validateSecretHeaders,
} from '@/lib/http/secretHeaders';

export {
  encryptHeaderPatch,
  encryptHeaderValues,
} from '@/lib/http/secretHeaders';

export type McpServerRow = typeof mcpServers.$inferSelect;
export type McpOauthRow = typeof mcpOauth.$inferSelect;

/** `McpServerRow` with secrets replaced by presence booleans — safe to send to the client. */
export type SanitizedMcpServerRow = Omit<
  McpServerRow,
  'secretToken' | 'oauthClientSecret' | 'extraHeaders'
> & { hasToken: boolean; hasSecret: boolean; extraHeaderNames: string[] };

/** Per-tool overrides for an MCP server, keyed by tool name. */
export type McpToolConfig = NonNullable<McpServerRow['toolConfig']>;

/**
 * Redact secrets from a server row before sending to the client. Extra-header
 * *names* survive so the UI can list what's configured; the values never leave
 * the server.
 */
export function redactServer(row: McpServerRow): SanitizedMcpServerRow {
  const {
    secretToken,
    oauthClientSecret,
    extraHeaders: _extraHeaders,
    ...rest
  } = row;
  return {
    ...rest,
    hasToken: !!secretToken,
    hasSecret: !!oauthClientSecret,
    extraHeaderNames: getSecretHeaderNames(row.extraHeaders),
  };
}

/**
 * Decrypt `secretToken`/`oauthClientSecret`/`extraHeaders` on a server row read
 * from the DB. Tolerates null values and legacy plaintext (pre-encryption rows
 * not yet caught by `migrateMcpAuth()`), so it's safe to call unconditionally on
 * every read path.
 */
export function decryptServerSecrets(row: McpServerRow): McpServerRow {
  return {
    ...row,
    secretToken: decryptTolerant(
      row.secretToken,
      `secretToken for server ${row.id}`,
    ),
    oauthClientSecret: decryptTolerant(
      row.oauthClientSecret,
      `oauthClientSecret for server ${row.id}`,
    ),
  };
}

/**
 * A row's extra headers with each value decrypted. Returns `{}` when unset, and
 * drops any entry whose value can't be decrypted, so one stale header can't
 * take down the whole connection.
 *
 * `extraHeaders` is deliberately *not* handled by `decryptServerSecrets()`:
 * only the values are encrypted, so decryption happens per-entry here.
 */
export function parseExtraHeaders(row: McpServerRow): Record<string, string> {
  return decryptHeaderValues(row.extraHeaders, `header for server ${row.id}`);
}

/**
 * Transport options carrying a server's headers: the `bearer` auth header (when
 * configured) plus any extra headers, which win on conflict as the more
 * specific configuration. Returns undefined when there is nothing to send, so
 * callers can spread it without forcing an empty `requestInit`.
 *
 * Applied to *every* transport, not just bearer — a server can need a
 * credential header alongside OAuth, or with `authType: 'none'`.
 */
export function buildRequestInit(
  server: McpServerRow,
): { requestInit: { headers: Record<string, string> } } | undefined {
  const headers: Record<string, string> = {};

  if (server.authType === 'bearer') {
    const headerName = server.headerName ?? 'Authorization';
    headers[headerName] =
      headerName.toLowerCase() === 'authorization'
        ? `Bearer ${server.secretToken ?? ''}`
        : (server.secretToken ?? '');
  }

  Object.assign(headers, parseExtraHeaders(server));

  return Object.keys(headers).length > 0
    ? { requestInit: { headers } }
    : undefined;
}

/** Validate MCP's existing extra-header payload using the shared rules. */
export function validateExtraHeaders(
  value: unknown,
  { allowNull = false }: { allowNull?: boolean } = {},
): string | null {
  return validateSecretHeaders(value, {
    allowNull,
    fieldName: allowNull ? 'extraHeadersPatch' : 'extraHeaders',
    // MCP historically used only the RFC-token/CRLF checks and entry cap.
    // Keep its accepted value sizes and control-character behavior unchanged;
    // compatible providers use the stricter default.
    legacyCompatibility: true,
  });
}

/**
 * Resolve the effective setting for a tool, applying defaults (enabled + always
 * ask) when the config has no entry or omits a field.
 */
export function resolveToolSetting(
  config: McpToolConfig | null | undefined,
  toolName: string,
): { enabled: boolean; requiresApproval: boolean } {
  const entry = config?.[toolName];
  return {
    enabled: entry?.enabled !== false,
    requiresApproval: entry?.approval !== 'never',
  };
}

/** A server's workspace scope, as produced by `getServerWorkspaceScopes()`. */
export interface ServerWorkspaceScope {
  workspaceIds: Set<string>;
  visibleInGeneralChat: boolean;
}

/**
 * Whether a server should be offered in a given chat, given its workspace
 * scope. An empty (or absent) scope means "available everywhere" — the
 * unchanged default. A non-empty scope restricts to those workspaces' chats,
 * plus unscoped chats when `visibleInGeneralChat` is set.
 */
export function isServerVisibleForChat(
  scope: ServerWorkspaceScope | undefined,
  chatWorkspaceId: string | null,
): boolean {
  if (!scope || scope.workspaceIds.size === 0) return true;
  if (chatWorkspaceId === null) return scope.visibleInGeneralChat;
  return scope.workspaceIds.has(chatWorkspaceId);
}

/** A single MCP tool as discovered from a server, namespaced for use as a LangChain tool. */
export interface McpToolDescriptor {
  serverId: string;
  serverName: string;
  toolName: string;
  /** `mcp__<serverSlug>__<toolName>` — the LangChain tool name and markup correlation key */
  namespacedName: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>;
}

/** Thrown when the MCP server requires authentication (OAuth or bearer) to connect. */
export class McpAuthRequiredError extends Error {
  constructor(
    public readonly serverId: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpAuthRequiredError';
  }
}

/** Slug-safe server name for tool namespacing (lowercase alphanumeric + underscore). */
export function serverNameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Build the namespaced tool name: `mcp__<serverSlug>__<toolName>`.
 * Truncates with a short hash suffix if the result exceeds provider name limits (~60 chars).
 */
export function buildNamespacedName(
  serverName: string,
  toolName: string,
): string {
  const slug = serverNameSlug(serverName);
  const candidate = `mcp__${slug}__${toolName}`;
  if (candidate.length <= 60) return candidate;
  // Hash suffix to keep uniqueness when truncating
  const hash = createHash('sha1').update(candidate).digest('hex').slice(0, 6);
  return `${candidate.slice(0, 53)}_${hash}`;
}
