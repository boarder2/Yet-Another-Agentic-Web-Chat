import { NextRequest, NextResponse } from 'next/server';
import { unarchiveWorkspace } from '@/lib/workspaces/service';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await unarchiveWorkspace(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ workspace: row });
}
