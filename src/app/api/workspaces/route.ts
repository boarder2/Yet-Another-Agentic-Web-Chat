import { NextRequest, NextResponse } from 'next/server';
import { createWorkspace, listWorkspaces } from '@/lib/workspaces/service';

export async function GET(req: NextRequest) {
  const archived = req.nextUrl.searchParams.get('archived') === 'true';
  try {
    const rows = await listWorkspaces({ archived });
    return NextResponse.json({ workspaces: rows });
  } catch {
    return NextResponse.json(
      { error: 'Failed to list workspaces' },
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
    if (!body.chatModel?.provider || !body.chatModel?.name) {
      return NextResponse.json(
        { error: 'chatModel.{provider,name} required' },
        { status: 400 },
      );
    }
    const row = await createWorkspace(body);
    return NextResponse.json({ workspace: row });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 },
    );
  }
}
