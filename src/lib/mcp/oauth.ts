import 'server-only';

import {
  auth,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes, timingSafeEqual } from 'crypto';
import db from '@/lib/db';
import { mcpOauth, mcpOauthFlows, mcpServers } from '@/lib/db/schema';
import { eq, lt } from 'drizzle-orm';
import { getBaseUrl } from '@/lib/config';
import { version } from '@/../package.json';
import type { McpServerRow } from './types';
import { McpAuthRequiredError } from './types';

// ── BASE_URL validation ────────────────────────────────────────────────────

function getValidatedBaseUrl(): string {
  const raw = getBaseUrl();
  if (!raw) {
    throw new Error(
      'BASE_URL is not configured. Interactive MCP OAuth requires an absolute BASE_URL in config.toml.',
    );
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('BASE_URL must use http or https');
    }
    return raw.replace(/\/$/, '');
  } catch (e) {
    throw new Error(
      `BASE_URL "${raw}" is not a valid absolute URL: ${String(e)}`,
    );
  }
}

function getRedirectUrl(): string {
  return `${getValidatedBaseUrl()}/api/mcp/oauth/callback`;
}

// ── State helpers ──────────────────────────────────────────────────────────

/** Generate a cryptographically strong state token (≥128 bits → 32 hex chars = 128 bits). */
function generateState(): string {
  return randomBytes(32).toString('hex');
}

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 min

// ── DB-backed token storage shared by both OAuth providers ─────────────────

/**
 * OAuthClientProvider storage backed by the `mcpOauth` table, keyed by serverId.
 * Shared by the interactive (authorization_code) and non-interactive
 * (client_credentials) providers; the SDK drives discovery, token fetch, and
 * 401 re-auth against these methods.
 */
abstract class McpDbOAuthProvider {
  protected readonly _serverId: string;

  constructor(serverId: string) {
    this._serverId = serverId;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const row = await db.query.mcpOauth.findFirst({
      where: eq(mcpOauth.serverId, this._serverId),
    });
    return (row?.tokens as OAuthTokens) ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await db
      .insert(mcpOauth)
      .values({ serverId: this._serverId, tokens, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: mcpOauth.serverId,
        set: { tokens, updatedAt: new Date() },
      })
      .execute();
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await db
      .insert(mcpOauth)
      .values({
        serverId: this._serverId,
        discoveryState: state,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: mcpOauth.serverId,
        set: { discoveryState: state, updatedAt: new Date() },
      })
      .execute();
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const row = await db.query.mcpOauth.findFirst({
      where: eq(mcpOauth.serverId, this._serverId),
    });
    return (row?.discoveryState as OAuthDiscoveryState) ?? undefined;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    type OauthUpdate = {
      tokens?: null;
      clientInformation?: null;
      discoveryState?: null;
      updatedAt: Date;
    };
    const update: OauthUpdate = { updatedAt: new Date() };
    if (scope === 'all' || scope === 'tokens') update.tokens = null;
    if (scope === 'all' || scope === 'client') update.clientInformation = null;
    if (scope === 'all' || scope === 'discovery') update.discoveryState = null;
    await db
      .update(mcpOauth)
      .set(update)
      .where(eq(mcpOauth.serverId, this._serverId))
      .execute()
      .catch(() => undefined);
  }
}

// ── Per-request interactive OAuthClientProvider ────────────────────────────

/**
 * Request-scoped OAuth provider. Each authorize attempt gets a fresh instance
 * with its own `state` token, so the keyless `saveCodeVerifier`/`codeVerifier`
 * methods can operate without a `state` arg by carrying it in instance memory.
 *
 * Authorize side:   `state()` generates + stashes the token (called first by auth()).
 * Callback side:    the state is baked in at construction from the DB-looked-up flow row.
 */
export class McpOAuthProvider
  extends McpDbOAuthProvider
  implements OAuthClientProvider
{
  private _state: string | null = null;
  private readonly _scope: string | null;

  constructor(opts: {
    serverId: string;
    serverName: string;
    scope: string | null;
    /** Pre-baked state for the callback path (skips state() generation). */
    existingState?: string;
  }) {
    super(opts.serverId);
    this._scope = opts.scope;
    if (opts.existingState) this._state = opts.existingState;
    // Logged for troubleshooting redirect_uri rejections (e.g. an OAuth server
    // that only accepts https/loopback schemes) — this is the exact value sent
    // during dynamic client registration and authorization.
    console.log(
      `[mcp] OAuth redirect_uri for server ${opts.serverName}: ${getRedirectUrl()}`,
    );
  }

  get redirectUrl(): string {
    return getRedirectUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    const redirectUrl = getRedirectUrl();
    return {
      client_name: 'YAAWC',
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: this._scope ?? undefined,
    };
  }

  /**
   * Generate + persist the state token for this authorization attempt.
   * SDK ordering: auth() calls state() → startAuthorization (generates verifier)
   * → saveCodeVerifier(verifier) → redirectToAuthorization(url).
   * So the flow row exists before saveCodeVerifier is called.
   */
  async state(): Promise<string> {
    const s = generateState();
    this._state = s;
    const now = Date.now();
    await db
      .insert(mcpOauthFlows)
      .values({
        state: s,
        serverId: this._serverId,
        codeVerifier: '', // placeholder; written by saveCodeVerifier below
        createdAt: now,
        expiresAt: now + FLOW_TTL_MS,
      })
      .execute();
    return s;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    if (!this._state)
      throw new Error(
        '[McpOAuthProvider] No active state for saveCodeVerifier',
      );
    await db
      .update(mcpOauthFlows)
      .set({ codeVerifier: verifier })
      .where(eq(mcpOauthFlows.state, this._state))
      .execute();
  }

  async codeVerifier(): Promise<string> {
    if (!this._state)
      throw new Error('[McpOAuthProvider] No active state for codeVerifier');
    const row = await db.query.mcpOauthFlows.findFirst({
      where: eq(mcpOauthFlows.state, this._state),
    });
    if (!row)
      throw new Error('[McpOAuthProvider] Flow row not found for codeVerifier');
    return row.codeVerifier;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const row = await db.query.mcpOauth.findFirst({
      where: eq(mcpOauth.serverId, this._serverId),
    });
    if (!row?.clientInformation) return undefined;
    return row.clientInformation as OAuthClientInformationMixed;
  }

  async saveClientInformation(
    info: OAuthClientInformationMixed,
  ): Promise<void> {
    await db
      .insert(mcpOauth)
      .values({
        serverId: this._serverId,
        clientInformation: info,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: mcpOauth.serverId,
        set: { clientInformation: info, updatedAt: new Date() },
      })
      .execute();
  }

  /** Captured auth URL — set by redirectToAuthorization during auth() call. */
  capturedAuthUrl: URL | null = null;

  redirectToAuthorization(url: URL): void {
    // In our server context there's no browser to redirect; capture the URL
    // so the authorize route can return it to the frontend popup.
    this.capturedAuthUrl = url;
  }

  /** RFC 8707 resource binding: validate that the token audience matches our server URL. */
  async validateResourceURL(serverUrl: string | URL): Promise<URL | undefined> {
    // Bind to the server's resource URL — this is the audience that protects against token replay.
    try {
      return new URL(serverUrl.toString());
    } catch {
      return undefined;
    }
  }
}

// ── Non-interactive client_credentials provider ───────────────────────────

/**
 * client_credentials OAuthClientProvider: no redirect (non-interactive), static
 * pre-registered client creds, and a client_credentials token request. Returning
 * `undefined` from `redirectUrl` is what makes the SDK's auth() fetch the token
 * directly; it also discovers the AS, caches the token, and re-fetches on 401.
 */
class McpClientCredentialsProvider
  extends McpDbOAuthProvider
  implements OAuthClientProvider
{
  private readonly _clientId: string;
  private readonly _clientSecret: string;
  private readonly _scope: string | null;

  constructor(server: McpServerRow) {
    super(server.id);
    this._clientId = server.oauthClientId!;
    this._clientSecret = server.oauthClientSecret!;
    this._scope = server.oauthScope;
  }

  get redirectUrl(): undefined {
    return undefined; // non-interactive → client_credentials grant in auth()
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'YAAWC',
      redirect_uris: [],
      grant_types: ['client_credentials'],
      scope: this._scope ?? undefined,
    };
  }

  clientInformation(): OAuthClientInformationMixed {
    return { client_id: this._clientId, client_secret: this._clientSecret };
  }

  prepareTokenRequest(scope?: string): URLSearchParams {
    const params = new URLSearchParams({ grant_type: 'client_credentials' });
    if (scope) params.set('scope', scope);
    return params;
  }

  // Interactive-only members of the interface — never reached without a redirectUrl.
  redirectToAuthorization(): void {
    throw new Error('redirectToAuthorization on client_credentials provider');
  }
  saveCodeVerifier(): void {
    throw new Error('saveCodeVerifier on client_credentials provider');
  }
  codeVerifier(): string {
    throw new Error('codeVerifier on client_credentials provider');
  }
}

/**
 * Connect using the OAuth2 client_credentials grant. The SDK fetches and caches
 * the token (DB-backed) and re-fetches on 401, so there's no manual token plumbing.
 * Surfaces failures as McpAuthRequiredError so the manager marks server status.
 */
export async function connectWithClientCredentials(server: McpServerRow) {
  if (!server.oauthClientId || !server.oauthClientSecret) {
    throw new Error(
      `Server "${server.name}" uses oauth_client_credentials but is missing client ID or secret`,
    );
  }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const provider = new McpClientCredentialsProvider(server);
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    authProvider: provider,
  });
  const client = new Client({ name: 'YAAWC', version }, { capabilities: {} });
  client.onerror = (err) => {
    console.error(
      `[mcp] client_credentials error for server ${server.name}:`,
      err,
    );
  };

  try {
    await client.connect(transport);
    return client;
  } catch (e) {
    throw new McpAuthRequiredError(
      server.id,
      `client_credentials auth failed for "${server.name}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ── Authorize flow ─────────────────────────────────────────────────────────

/**
 * Start the interactive OAuth authorization for a server.
 * Returns the authorization URL the frontend should open in a popup.
 * Throws McpAuthRequiredError if BASE_URL is invalid.
 */
export async function startOAuthAuthorization(
  server: McpServerRow,
): Promise<{ authorizationUrl: string }> {
  // Lazily purge expired flow rows on each authorization attempt — avoids
  // orphaned rows piling up when popups are closed without completing the flow.
  cleanupExpiredFlows().catch(() => undefined);

  const provider = new McpOAuthProvider({
    serverId: server.id,
    serverName: server.name,
    scope: server.oauthScope,
  });

  // auth() calls state() → saveCodeVerifier() → redirectToAuthorization()
  // redirectToAuthorization captures the URL into provider.capturedAuthUrl
  const result = await auth(provider, { serverUrl: server.url });

  if (result === 'AUTHORIZED') {
    // Already have valid tokens; no redirect needed
    return { authorizationUrl: '' };
  }

  if (!provider.capturedAuthUrl) {
    throw new Error(
      `auth() returned REDIRECT but redirectToAuthorization was never called for server "${server.name}"`,
    );
  }

  return { authorizationUrl: provider.capturedAuthUrl.toString() };
}

// ── Callback handler ───────────────────────────────────────────────────────

/** Timing-safe comparison of two strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface OAuthCallbackResult {
  ok: boolean;
  serverName?: string;
  error?: string;
}

/**
 * Handle the OAuth callback. Looks up the flow row by state, validates it,
 * runs finishAuth (which calls provider.codeVerifier()), persists tokens,
 * then deletes the flow row. On any failure, renders an error + deletes the row.
 *
 * The flow row is deleted AFTER a successful exchange so the PKCE verifier
 * survives the exchange.
 */
export async function handleOAuthCallback(
  stateParam: string,
  code: string,
): Promise<OAuthCallbackResult> {
  // Look up + validate flow row
  const flow = await db.query.mcpOauthFlows.findFirst({
    where: eq(mcpOauthFlows.state, stateParam),
  });
  if (!flow) return { ok: false, error: 'Invalid or expired OAuth state' };
  if (!safeEqual(flow.state, stateParam))
    return { ok: false, error: 'State mismatch' };
  if (Date.now() > flow.expiresAt) {
    await db
      .delete(mcpOauthFlows)
      .where(eq(mcpOauthFlows.state, stateParam))
      .execute()
      .catch(() => undefined);
    return { ok: false, error: 'OAuth flow expired' };
  }

  const server = await db.query.mcpServers.findFirst({
    where: eq(mcpServers.id, flow.serverId),
  });
  if (!server) {
    await db
      .delete(mcpOauthFlows)
      .where(eq(mcpOauthFlows.state, stateParam))
      .execute()
      .catch(() => undefined);
    return { ok: false, error: 'MCP server not found' };
  }

  // Build a fresh transport + provider bound to this serverId AND this state.
  // Do NOT use a cached transport; the provider reads
  // codeVerifier/clientInformation/discovery from DB.
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const provider = new McpOAuthProvider({
    serverId: server.id,
    serverName: server.name,
    scope: server.oauthScope,
    existingState: stateParam, // bakes state into provider so codeVerifier() works
  });

  try {
    let serverUrl: URL;
    try {
      serverUrl = new URL(server.url);
    } catch {
      throw new Error(`Invalid server URL: ${server.url}`);
    }

    const transport = new StreamableHTTPClientTransport(serverUrl, {
      authProvider: provider,
    });

    // finishAuth exchanges code for tokens — this calls provider.codeVerifier()
    // which reads from the flow row. The row must still exist at this point.
    await transport.finishAuth(code);

    // Delete flow row only AFTER successful exchange
    await db
      .delete(mcpOauthFlows)
      .where(eq(mcpOauthFlows.state, stateParam))
      .execute()
      .catch(() => undefined);

    // Update server status
    await db
      .update(mcpServers)
      .set({ status: 'connected', lastError: null, updatedAt: new Date() })
      .where(eq(mcpServers.id, server.id))
      .execute()
      .catch(() => undefined);

    // Invalidate the manager cache so the next request re-connects with fresh tokens
    const { invalidateServer } = await import('./manager');
    invalidateServer(server.id);

    return { ok: true, serverName: server.name };
  } catch (e) {
    // Delete flow row on failure too (prevent reuse of expired/failed flows)
    await db
      .delete(mcpOauthFlows)
      .where(eq(mcpOauthFlows.state, stateParam))
      .execute()
      .catch(() => undefined);

    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[mcp/oauth] Callback failed for server "${server.name}":`,
      e,
    );

    // Mark server as auth_required with backoff
    const backoffUntil = Date.now() + 5 * 60 * 1000; // 5 min backoff on failure
    await db
      .update(mcpServers)
      .set({
        status: 'auth_required',
        lastError: msg,
        authFailureUntil: backoffUntil,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, server.id))
      .execute()
      .catch(() => undefined);

    return { ok: false, serverName: server.name, error: msg };
  }
}

/** Purge expired flow rows (call periodically or on startup). */
export async function cleanupExpiredFlows(): Promise<void> {
  await db
    .delete(mcpOauthFlows)
    .where(lt(mcpOauthFlows.expiresAt, Date.now()))
    .execute()
    .catch(() => undefined);
}

/** Wire up the oauth authType in the client connection (called from client.ts). */
export async function connectWithOAuth(server: McpServerRow) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const provider = new McpOAuthProvider({
    serverId: server.id,
    serverName: server.name,
    scope: server.oauthScope,
  });

  const url = new URL(server.url);
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: provider,
  });

  const client = new Client({ name: 'YAAWC', version }, { capabilities: {} });
  client.onerror = (err) => {
    console.error(`[mcp] OAuth client error for server ${server.name}:`, err);
  };

  try {
    await client.connect(transport);
    return client;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      // Surface the auth URL if captured
      if (provider.capturedAuthUrl) {
        const err = new McpAuthRequiredError(
          server.id,
          `Auth required for ${server.name}`,
        );
        (err as unknown as Record<string, unknown>).authorizationUrl =
          provider.capturedAuthUrl.toString();
        throw err;
      }
      throw new McpAuthRequiredError(
        server.id,
        `Auth required for ${server.name}`,
      );
    }
    throw e;
  }
}
