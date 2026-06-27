import 'server-only';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import db from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  McpAuthRequiredError,
  buildNamespacedName,
  type McpToolConfig,
  type McpToolDescriptor,
  type McpServerRow,
} from './types';
import { connectMcpServer } from './client';

// ── Cache types ────────────────────────────────────────────────────────────

interface CachedConnection {
  /** Resolves to the connected client, or rejects. Single promise per server prevents stampede. */
  clientPromise: Promise<Client>;
  /** Resolved descriptors from the last successful listTools(); null if not yet fetched. */
  descriptors: McpToolDescriptor[] | null;
  /** When descriptors were last fetched (ms epoch). */
  descriptorsFetchedAt: number;
  /** Whether the cached connection is still considered alive. */
  alive: boolean;
}

// Module-scoped process singleton. Best-effort under dev/turbopack multi-worker:
// tokens live in the DB so cold workers re-discover cheaply.
const cache = new Map<string, CachedConnection>();

const DESCRIPTOR_TTL_MS = 5 * 60 * 1000; // 5 min
const CONNECT_TIMEOUT_MS = 3000; // per-server connect+listTools timeout on hot path

// ── Helpers ────────────────────────────────────────────────────────────────

function evict(serverId: string): void {
  cache.delete(serverId);
}

/** Race a promise against a timeout; rejects with Error('timeout') on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

/** Mark server status and last error in the DB (best-effort, non-fatal). */
async function markServerStatus(
  serverId: string,
  status: McpServerRow['status'],
  lastError?: string,
): Promise<void> {
  try {
    await db
      .update(mcpServers)
      .set({
        status,
        lastError: lastError ?? null,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, serverId))
      .execute();
  } catch {
    // non-fatal
  }
}

/** Connect to a server, returning a client promise and registering it in cache. */
function openConnection(server: McpServerRow): Promise<Client> {
  const promise = connectMcpServer(server).then((client) => {
    // Only mark alive if this promise is still the cache entry's clientPromise.
    // A race (e.g., timed-out connectAndDiscover replaced clientPromise before
    // this slow connection resolved) would otherwise mark the wrong entry alive.
    const entry = cache.get(server.id);
    if (entry && entry.clientPromise === promise) {
      entry.alive = true;
      // Override the default onerror set in client.ts: SSE disconnects (e.g. keepalive
      // cycles, idle timeouts) are transient — warn rather than error, and mark the
      // entry dead so the next call triggers a reconnect.
      client.onerror = (err) => {
        console.warn(
          `[mcp] connection dropped for server ${server.name}:`,
          err,
        );
        entry.alive = false;
      };
    }
    db.update(mcpServers)
      .set({
        lastConnectedAt: Date.now(),
        status: 'connected',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, server.id))
      .execute()
      .catch(() => undefined);
    return client;
  });
  return promise;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Invalidate the cached connection + descriptors for a server (call after edit/delete).
 */
export function invalidateServer(serverId: string): void {
  evict(serverId);
}

/**
 * Per-tool config maps for all enabled servers, keyed by server id. Read fresh
 * (cheap single query) so settings edits take effect on the next agent turn
 * without invalidating the descriptor cache.
 */
export async function getEnabledServerToolConfigs(): Promise<
  Map<string, McpToolConfig>
> {
  // Intentionally NOT swallowed: if this read fails we must fail closed — the
  // caller (buildMcpLangchainTools) omits ALL MCP tools for the turn rather than
  // injecting tools whose disable/approval overrides we can't honor.
  const rows = await db
    .select({ id: mcpServers.id, toolConfig: mcpServers.toolConfig })
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true));
  const map = new Map<string, McpToolConfig>();
  for (const row of rows) {
    if (row.toolConfig) map.set(row.id, row.toolConfig);
  }
  return map;
}

/**
 * Get tool descriptors for all enabled MCP servers.
 *
 * Hot-path latency mitigations:
 * - Stale-while-revalidate: if descriptors exist (even if stale) return them
 *   immediately and refresh in background.
 * - Parallel discovery across servers.
 * - Per-server bounded timeout (CONNECT_TIMEOUT_MS) on cold miss; server is
 *   simply omitted for that turn on timeout.
 */
export async function getToolDescriptorsForEnabledServers(): Promise<
  McpToolDescriptor[]
> {
  let rows: McpServerRow[];
  try {
    rows = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true));
  } catch (e) {
    console.error('[mcp/manager] Failed to query mcp_servers:', e);
    return [];
  }

  const now = Date.now();
  const results: McpToolDescriptor[] = [];
  const backgroundRefreshTasks: Promise<void>[] = [];

  await Promise.all(
    rows.map(async (server) => {
      // Skip servers in auth backoff lockout
      if (server.authFailureUntil && now < server.authFailureUntil) return;

      const cached = cache.get(server.id);

      if (cached?.descriptors) {
        // Serve stale descriptors immediately
        results.push(...cached.descriptors);

        // Refresh in background if TTL expired
        if (now - cached.descriptorsFetchedAt > DESCRIPTOR_TTL_MS) {
          backgroundRefreshTasks.push(
            refreshDescriptors(server, cached).catch(() => undefined),
          );
        }
        return;
      }

      // Cold miss: connect + discover with timeout
      try {
        const descriptors = await withTimeout(
          connectAndDiscover(server),
          CONNECT_TIMEOUT_MS,
        );
        results.push(...descriptors);
      } catch (e) {
        if (e instanceof McpAuthRequiredError) {
          await markServerStatus(
            server.id,
            'auth_required',
            'Authentication required',
          );
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(
            `[mcp/manager] Failed to discover tools for ${server.name}:`,
            msg,
          );
          await markServerStatus(server.id, 'error', msg);
        }
      }
    }),
  );

  // Fire-and-forget background refreshes (don't await — hot path)
  for (const task of backgroundRefreshTasks) {
    void task;
  }

  return results;
}

/** Connect to a server and fetch its tool list; cache both. */
async function connectAndDiscover(
  server: McpServerRow,
): Promise<McpToolDescriptor[]> {
  let entry = cache.get(server.id);
  if (!entry) {
    const clientPromise = openConnection(server);
    entry = {
      clientPromise,
      descriptors: null,
      descriptorsFetchedAt: 0,
      alive: false,
    };
    cache.set(server.id, entry);
  } else if (!entry.alive) {
    // Dead connection: replace promise
    entry.clientPromise = openConnection(server);
    entry.alive = false;
  }

  const client = await entry.clientPromise;
  const descriptors = await fetchDescriptors(server, client);
  entry.descriptors = descriptors;
  entry.descriptorsFetchedAt = Date.now();
  return descriptors;
}

/** Refresh descriptors for a server that is already connected (background). */
async function refreshDescriptors(
  server: McpServerRow,
  entry: CachedConnection,
): Promise<void> {
  try {
    const client = await entry.clientPromise;
    // listTools self-bounds via its timeout option, so no withTimeout wrap.
    const descriptors = await fetchDescriptors(server, client);
    entry.descriptors = descriptors;
    entry.descriptorsFetchedAt = Date.now();
  } catch {
    // Non-fatal background refresh failure; keep stale descriptors
  }
}

/** List all tools from a client (paginating on nextCursor), capped at 50 per server. */
async function fetchDescriptors(
  server: McpServerRow,
  client: Client,
  timeout = CONNECT_TIMEOUT_MS,
): Promise<McpToolDescriptor[]> {
  const TOOL_CAP = 50;
  const descriptors: McpToolDescriptor[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listTools(cursor ? { cursor } : undefined, {
      timeout,
    });
    for (const tool of result.tools) {
      if (descriptors.length >= TOOL_CAP) {
        console.warn(
          `[mcp/manager] Server "${server.name}" has more than ${TOOL_CAP} tools; capping.`,
        );
        return descriptors;
      }
      descriptors.push({
        serverId: server.id,
        serverName: server.name,
        toolName: tool.name,
        namespacedName: buildNamespacedName(server.name, tool.name),
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      });
    }
    cursor = result.nextCursor;
  } while (cursor);

  return descriptors;
}

/**
 * Call an MCP tool on the cached client for a server.
 * Reconnects if the cached connection is dead.
 */
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<{ content: string; isError: boolean }> {
  const server = await db.query.mcpServers.findFirst({
    where: eq(mcpServers.id, serverId),
  });
  if (!server) throw new Error(`MCP server ${serverId} not found`);

  let entry = cache.get(serverId);
  if (!entry || !entry.alive) {
    const clientPromise = openConnection(server);
    entry = {
      clientPromise,
      descriptors: entry?.descriptors ?? null,
      descriptorsFetchedAt: entry?.descriptorsFetchedAt ?? 0,
      alive: false,
    };
    cache.set(serverId, entry);
  }

  const client = await entry.clientPromise;

  // The SDK honors signal + timeout natively (throws McpError on timeout, sends a
  // cancellation notification on abort) — no manual race/withTimeout plumbing.
  let result;
  try {
    result = await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      {
        signal: options.signal,
        timeout: options.timeout,
      },
    );
  } catch (e) {
    // Mark connection dead so subsequent calls reconnect
    const entry = cache.get(serverId);
    if (entry) entry.alive = false;
    throw e;
  }

  // Normalize content array to string
  const content = normalizeContent(result.content as ContentBlock[]);
  return { content, isError: !!result.isError };
}

function normalizeContent(content: ContentBlock[]): string {
  return content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'image':
          return '[image attachment — not rendered in v1]';
        case 'audio':
          return '[audio attachment — not rendered in v1]';
        case 'resource_link':
          return block.uri ? `[resource: ${block.uri}]` : '[resource link]';
        case 'resource':
          return block.resource?.uri
            ? `[resource: ${block.resource.uri}]`
            : '[resource]';
        default:
          return JSON.stringify(block);
      }
    })
    .join('\n');
}

/**
 * Connect to a server and list its tools without persisting discovery to the module cache.
 * Used by the test-connection route to validate server credentials without side effects.
 */
export async function testMcpServerConnection(server: McpServerRow): Promise<{
  status: McpServerRow['status'];
  toolCount: number;
  toolNames: string[];
  error?: string;
}> {
  try {
    const client = await withTimeout(connectMcpServer(server), 5000);
    const descriptors = await fetchDescriptors(server, client, 5000);
    await client.close().catch(() => undefined);
    return {
      status: 'connected',
      toolCount: descriptors.length,
      toolNames: descriptors.map((d) => d.toolName),
    };
  } catch (e) {
    if (e instanceof McpAuthRequiredError) {
      return {
        status: 'auth_required',
        toolCount: 0,
        toolNames: [],
        error: e.message,
      };
    }
    return {
      status: 'error',
      toolCount: 0,
      toolNames: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
