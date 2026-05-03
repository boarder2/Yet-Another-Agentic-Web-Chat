import { NextRequest, NextResponse } from 'next/server';
import {
  readFileBytes,
  replaceFile,
  deleteFile,
  getFile,
} from '@/lib/workspaces/files';
import { hasNulByte } from '@/lib/workspaces/paths';
import db from '@/lib/db';
import { workspaceFiles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const result = await readFileBytes(id, fileId);
  if (!result)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const wantBytes = req.nextUrl.searchParams.get('raw') === 'true';
  if (wantBytes) {
    return new NextResponse(result.bytes as unknown as BodyInit, {
      headers: {
        'content-type': result.row.mime ?? 'application/octet-stream',
        'content-disposition': `inline; filename="${encodeURIComponent(result.row.name)}"`,
      },
    });
  }
  const isBinary = hasNulByte(result.bytes);
  return NextResponse.json({
    file: result.row,
    content: isBinary ? null : result.bytes.toString('utf8'),
    isBinary,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const body = await req.json();
  if (typeof body.content !== 'string')
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  const existing = await getFile(id, fileId);
  if (!existing)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const bytes = Buffer.from(body.content, 'utf8');
  if (bytes.length > 10 * 1024 * 1024)
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  if (hasNulByte(bytes))
    return NextResponse.json(
      { error: 'cannot save binary content' },
      { status: 400 },
    );
  const row = await replaceFile({ workspaceId: id, fileId, bytes });
  return NextResponse.json({ file: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const ok = await deleteFile(id, fileId);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const body = await req.json();

  const existing = await getFile(id, fileId);
  if (!existing)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only allow patching autoAcceptEdits
  const { autoAcceptEdits } = body;
  if (
    autoAcceptEdits !== null &&
    autoAcceptEdits !== 0 &&
    autoAcceptEdits !== 1
  ) {
    return NextResponse.json(
      { error: 'autoAcceptEdits must be 0, 1, or null' },
      { status: 400 },
    );
  }

  const [row] = await db
    .update(workspaceFiles)
    .set({ autoAcceptEdits: autoAcceptEdits as 0 | 1 | null })
    .where(
      and(eq(workspaceFiles.workspaceId, id), eq(workspaceFiles.id, fileId)),
    )
    .returning();

  return NextResponse.json({ file: row });
}
