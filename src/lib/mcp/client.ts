import 'server-only';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { version } from '@/../package.json';
import db from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { McpAuthRequiredError, type McpServerRow } from './types';

// Validate URL at the call site: throws if malformed.
function parseUrl(urlStr: string, serverId: string): URL {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(
        `MCP server URL must use http or https (server ${serverId})`,
      );
    }
    return u;
  } catch (e) {
    throw new Error(
      `Invalid MCP server URL "${urlStr}" for server ${serverId}: ${String(e)}`,
    );
  }
}

function buildBearerTransport(
  url: URL,
  server: McpServerRow,
): StreamableHTTPClientTransport {
  const headerName = server.headerName ?? 'Authorization';
  const headerValue =
    headerName.toLowerCase() === 'authorization'
      ? `Bearer ${server.secretToken ?? ''}`
      : (server.secretToken ?? '');
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { [headerName]: headerValue } },
  });
}

const authError = (server: McpServerRow): McpAuthRequiredError =>
  new McpAuthRequiredError(server.id, `Auth required for ${server.name}`);

/** Connect a transport, converting a 401/UnauthorizedError to McpAuthRequiredError. */
async function connectOrAuth(
  client: Client,
  transport: Transport,
  server: McpServerRow,
): Promise<void> {
  try {
    await client.connect(transport);
  } catch (e) {
    if (e instanceof UnauthorizedError) throw authError(server);
    throw e;
  }
}

/** Persist the negotiated transport so future connections skip the auto probe. */
async function persistResolvedTransport(
  server: McpServerRow,
  resolved: 'streamableHttp' | 'sse',
): Promise<void> {
  await db
    .update(mcpServers)
    .set({ resolvedTransport: resolved })
    .where(eq(mcpServers.id, server.id))
    .execute()
    .catch(() => undefined);
}

/**
 * Connect to an MCP server and return a ready Client.
 * - Handles none/bearer auth (OAuth is handled in oauth.ts via authProvider).
 * - auto transport: tries StreamableHTTP first, falls back to SSE (never on 401).
 * - Throws McpAuthRequiredError if the server returns 401/UnauthorizedError.
 */
export async function connectMcpServer(server: McpServerRow): Promise<Client> {
  const url = parseUrl(server.url, server.id);

  const client = new Client({ name: 'YAAWC', version }, { capabilities: {} });

  client.onerror = (err) => {
    console.error(`[mcp] client error for server ${server.name}:`, err);
  };

  if (server.authType === 'bearer') {
    await client.connect(buildBearerTransport(url, server));
  } else if (server.authType === 'oauth') {
    // Full interactive OAuth: delegate to the OAuth module which constructs
    // the provider with DB-backed token storage and handles the auth dance.
    const { connectWithOAuth } = await import('./oauth');
    return connectWithOAuth(server);
  } else if (server.authType === 'oauth_client_credentials') {
    // Non-interactive OAuth: the provider hands the SDK static client creds and
    // a client_credentials token request; the SDK fetches/caches/refreshes.
    const { connectWithClientCredentials } = await import('./oauth');
    return connectWithClientCredentials(server);
  } else if (
    server.transport === 'streamableHttp' ||
    server.resolvedTransport === 'streamableHttp'
  ) {
    await connectOrAuth(client, new StreamableHTTPClientTransport(url), server);
  } else if (server.transport === 'sse' || server.resolvedTransport === 'sse') {
    await connectOrAuth(client, new SSEClientTransport(url), server);
  } else {
    // auto: probe StreamableHTTP first, fall back to SSE only on non-401 errors
    try {
      await client.connect(new StreamableHTTPClientTransport(url));
      await persistResolvedTransport(server, 'streamableHttp');
    } catch (e) {
      // Never fall back on 401 — surface auth error immediately
      if (e instanceof UnauthorizedError) throw authError(server);
      await connectOrAuth(client, new SSEClientTransport(url), server);
      await persistResolvedTransport(server, 'sse');
    }
  }

  return client;
}
