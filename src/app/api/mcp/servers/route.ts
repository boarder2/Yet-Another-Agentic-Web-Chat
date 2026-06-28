import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { redactServer } from '@/lib/mcp/types';

export async function GET() {
  try {
    const rows = await db.select().from(mcpServers);
    return NextResponse.json({ servers: rows.map(redactServer) });
  } catch {
    return NextResponse.json(
      { error: 'Failed to list MCP servers' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    if (!body.url || typeof body.url !== 'string') {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }

    // Validate URL
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

    const row = await db
      .insert(mcpServers)
      .values({
        name: body.name as string,
        url: body.url as string,
        transport:
          (body.transport as (typeof mcpServers.$inferInsert)['transport']) ??
          'auto',
        authType:
          (body.authType as (typeof mcpServers.$inferInsert)['authType']) ??
          'none',
        enabled: body.enabled !== false,
        headerName: (body.headerName as string | undefined) ?? null,
        secretToken: (body.secretToken as string | undefined) ?? null,
        oauthClientId: (body.oauthClientId as string | undefined) ?? null,
        oauthClientSecret:
          (body.oauthClientSecret as string | undefined) ?? null,
        oauthScope: (body.oauthScope as string | undefined) ?? null,
      })
      .returning();

    return NextResponse.json({ server: redactServer(row[0]) }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) {
      return NextResponse.json(
        { error: 'A server with that name already exists' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to create MCP server' },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  // Bulk delete not exposed; handled per-server at /api/mcp/servers/[id]
  return NextResponse.json(
    { error: 'Use DELETE /api/mcp/servers/:id' },
    { status: 405 },
  );
}
