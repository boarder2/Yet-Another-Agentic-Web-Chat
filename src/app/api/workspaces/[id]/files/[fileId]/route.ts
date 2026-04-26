import { NextRequest, NextResponse } from 'next/server';
import {
  readFileBytes,
  replaceFile,
  deleteFile,
  getFile,
} from '@/lib/workspaces/files';

const TEXT_MIMES =
  /^(text\/|application\/(json|xml|javascript|typescript|x-yaml))/;

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
  const isText = result.row.mime ? TEXT_MIMES.test(result.row.mime) : true;
  return NextResponse.json({
    file: result.row,
    content: isText ? result.bytes.toString('utf8') : null,
    isBinary: !isText,
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
  const isText = existing.mime ? TEXT_MIMES.test(existing.mime) : true;
  if (!isText)
    return NextResponse.json(
      { error: 'cannot edit binary file' },
      { status: 400 },
    );
  const bytes = Buffer.from(body.content, 'utf8');
  if (bytes.length > 10 * 1024 * 1024)
    return NextResponse.json({ error: 'too large' }, { status: 413 });
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
