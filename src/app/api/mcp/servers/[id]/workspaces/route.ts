import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  listScopedWorkspaceIds,
  setScopedWorkspaceIds,
} from '@/lib/mcp/workspaceScopes';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const server = await db.query.mcpServers.findFirst({
    where: eq(mcpServers.id, id),
  });
  if (!server)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ workspaceIds: await listScopedWorkspaceIds(id) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  if (
    !Array.isArray(body.workspaceIds) ||
    !body.workspaceIds.every((v: unknown) => typeof v === 'string')
  ) {
    return NextResponse.json(
      { error: 'workspaceIds must be an array of strings' },
      { status: 400 },
    );
  }

  try {
    await setScopedWorkspaceIds(id, body.workspaceIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('FOREIGN KEY') || msg.includes('SQLITE_CONSTRAINT')) {
      return NextResponse.json(
        { error: 'One or more workspace ids do not exist' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to update workspace scope' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
