import { NextRequest, NextResponse } from 'next/server';
import { listFiles, createFile, getFileByName } from '@/lib/workspaces/files';
import { getWorkspace } from '@/lib/workspaces/service';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = await getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ files: await listFiles(id) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = await getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ct = req.headers.get('content-type') ?? '';
  let name: string;
  let mime: string | null;
  let bytes: Buffer;

  if (ct.startsWith('multipart/form-data')) {
    const fd = await req.formData();
    const f = fd.get('file');
    if (!(f instanceof File))
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (f.size > MAX_BYTES)
      return NextResponse.json({ error: 'file too large' }, { status: 413 });
    name = (fd.get('name') as string | null) ?? f.name;
    mime = f.type || null;
    bytes = Buffer.from(await f.arrayBuffer());
  } else {
    const body = await req.json();
    if (typeof body.name !== 'string' || typeof body.content !== 'string') {
      return NextResponse.json(
        { error: 'name and content required' },
        { status: 400 },
      );
    }
    name = body.name;
    mime = body.mime ?? 'text/plain';
    bytes = Buffer.from(body.content, 'utf8');
    if (bytes.length > MAX_BYTES)
      return NextResponse.json({ error: 'content too large' }, { status: 413 });
  }

  if (await getFileByName(id, name)) {
    return NextResponse.json({ error: 'name already exists' }, { status: 409 });
  }
  try {
    const row = await createFile({ workspaceId: id, name, mime, bytes });
    return NextResponse.json({ file: row });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'create failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
