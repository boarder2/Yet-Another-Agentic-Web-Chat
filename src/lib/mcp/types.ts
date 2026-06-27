import { createHash } from 'crypto';

import type { mcpServers, mcpOauth } from '@/lib/db/schema';

export type McpServerRow = typeof mcpServers.$inferSelect;
export type McpOauthRow = typeof mcpOauth.$inferSelect;

/** Per-tool overrides for an MCP server, keyed by tool name. */
export type McpToolConfig = NonNullable<McpServerRow['toolConfig']>;

/** Redact secrets from a server row before sending to the client. */
export function redactServer(row: McpServerRow) {
  const { secretToken, oauthClientSecret, ...rest } = row;
  return {
    ...rest,
    hasToken: !!secretToken,
    hasSecret: !!oauthClientSecret,
  };
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
