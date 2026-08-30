import { NextRequest, NextResponse } from 'next/server';
import { getWorkspace, updateWorkspace } from '@/lib/workspaces/service';
import { deleteWorkspace } from '@/lib/workspaces/delete';
import { WorkspaceInputValidationError } from '@/lib/workspaces/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await getWorkspace(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ workspace: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  delete body.id;
  delete body.createdAt;
  try {
    const row = await updateWorkspace(id, body);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ workspace: row });
  } catch (error) {
    if (error instanceof WorkspaceInputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await getWorkspace(id);
  if (!existing)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteWorkspace(id);
  return new NextResponse(null, { status: 204 });
}
