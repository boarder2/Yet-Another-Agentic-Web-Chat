import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { mcpServers, mcpServerWorkspaces } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { invalidateServer } from '@/lib/mcp/manager';
import {
  encryptHeaderPatch,
  encryptHeaderValues,
  redactServer,
  validateExtraHeaders,
} from '@/lib/mcp/types';
import { encrypt, isEncryptionConfigured } from '@/lib/encryption';

/** Cap on per-tool override entries to keep the JSON column bounded. */
const TOOL_CONFIG_MAX_ENTRIES = 200;

/**
 * Validate a partial tool-config patch: an object keyed by tool name whose
 * values are either `null` (delete the entry) or `{ enabled?: boolean;
 * approval?: 'always' | 'never' }`. Returns an error string, or null if valid.
 */
function validateToolConfigPatch(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'toolConfigPatch must be an object';
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > TOOL_CONFIG_MAX_ENTRIES) {
    return `toolConfigPatch has too many entries (max ${TOOL_CONFIG_MAX_ENTRIES})`;
  }
  for (const [key, entry] of entries) {
    // Reject reserved keys (defense-in-depth; not valid MCP tool names anyway)
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return `invalid tool name: ${key}`;
    }
    if (entry === null) continue; // deletion
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      return 'each toolConfig entry must be an object or null';
    }
    const e = entry as Record<string, unknown>;
    if ('enabled' in e && typeof e.enabled !== 'boolean') {
      return 'toolConfig entry "enabled" must be a boolean';
    }
    if ('approval' in e && e.approval !== 'always' && e.approval !== 'never') {
      return 'toolConfig entry "approval" must be "always" or "never"';
    }
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const row = await db.query.mcpServers.findFirst({
      where: eq(mcpServers.id, id),
    });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ server: redactServer(row) });
  } catch {
    return NextResponse.json(
      { error: 'Failed to get MCP server' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();

    if (body.url !== undefined) {
      try {
        const u = new URL(body.url as string);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return NextResponse.json(
            { error: 'url must use http or https' },
            { status: 400 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'url is not a valid URL' },
          { status: 400 },
        );
      }
    }

    if (body.toolConfigPatch !== undefined) {
      const err = validateToolConfigPatch(body.toolConfigPatch);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    if (body.extraHeaders !== undefined && body.extraHeaders !== null) {
      const err = validateExtraHeaders(body.extraHeaders);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    if (body.extraHeadersPatch !== undefined) {
      const err = validateExtraHeaders(body.extraHeadersPatch, {
        allowNull: true,
      });
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    if (
      (body.secretToken ||
        body.oauthClientSecret ||
        body.extraHeaders ||
        body.extraHeadersPatch) &&
      !isEncryptionConfigured()
    ) {
      return NextResponse.json(
        {
          error:
            'No encryption passphrase configured. Set SECURITY.ENCRYPTION_PASSPHRASE in config.toml before saving MCP secrets.',
        },
        { status: 503 },
      );
    }

    // Only accept known updatable fields. secretToken/oauthClientSecret are
    // handled separately below so they can be encrypted before storage.
    const allowed = [
      'name',
      'url',
      'transport',
      'authType',
      'enabled',
      'headerName',
      'oauthClientId',
      'oauthScope',
      'visibleInGeneralChat',
    ] as const;
    const strictBooleanKeys: readonly string[] = [
      'enabled',
      'visibleInGeneralChat',
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (key in body) {
        // Coerce boolean fields to strict booleans (POST does body.x !== false,
        // but PATCH must accept any JSON value).
        update[key] = strictBooleanKeys.includes(key)
          ? body[key] === true
          : body[key];
      }
    }
    if ('secretToken' in body) {
      update.secretToken = body.secretToken ? encrypt(body.secretToken) : null;
    }
    if ('oauthClientSecret' in body) {
      update.oauthClientSecret = body.oauthClientSecret
        ? encrypt(body.oauthClientSecret)
        : null;
    }
    if ('extraHeaders' in body) {
      // Whole-map replace.
      update.extraHeaders = body.extraHeaders
        ? encryptHeaderValues(body.extraHeaders as Record<string, string>)
        : null;
    }
    // Atomic per-header merge, mirroring toolConfigPatch: json_patch (RFC 7386)
    // sets the named headers and removes those whose value is null, leaving the
    // rest untouched — so changing one header never requires resupplying the
    // others, whose values the client can't read back.
    if (body.extraHeadersPatch !== undefined) {
      const encrypted = encryptHeaderPatch(
        body.extraHeadersPatch as Record<string, string | null>,
      );
      update.extraHeaders = sql`json_patch(coalesce(${mcpServers.extraHeaders}, '{}'), ${JSON.stringify(encrypted)})`;
    }
    // Changing URL/auth/transport invalidates resolved transport
    if ('url' in body || 'authType' in body || 'transport' in body) {
      update.resolvedTransport = null;
    }
    // Atomic per-tool merge: json_patch (RFC 7386) merges nested objects and
    // removes keys whose value is null, in a single UPDATE — no read-modify-write
    // race. Applied as a SQL expression so concurrent patches can't clobber.
    if (body.toolConfigPatch !== undefined) {
      update.toolConfig = sql`json_patch(coalesce(${mcpServers.toolConfig}, '{}'), ${JSON.stringify(body.toolConfigPatch)})`;
    }

    const rows = await db
      .update(mcpServers)
      .set(update)
      .where(eq(mcpServers.id, id))
      .returning();
    if (!rows.length)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Invalidate cache outside the try block's catch — a cache invalidation
    // failure must not mask a successful DB update with a 500.
    try {
      invalidateServer(id);
    } catch {
      // non-fatal: cache will be stale until next refresh cycle
    }
    return NextResponse.json({ server: redactServer(rows[0]) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) {
      return NextResponse.json(
        { error: 'A server with that name already exists' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to update MCP server' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    invalidateServer(id);
    await db
      .delete(mcpServerWorkspaces)
      .where(eq(mcpServerWorkspaces.serverId, id))
      .execute();
    await db.delete(mcpServers).where(eq(mcpServers.id, id)).execute();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'Failed to delete MCP server' },
      { status: 500 },
    );
  }
}
