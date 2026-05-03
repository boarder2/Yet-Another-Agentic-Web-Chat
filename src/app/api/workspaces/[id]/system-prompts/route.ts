import { NextRequest, NextResponse } from 'next/server';
import { listLinks, setLinks } from '@/lib/workspaces/systemPromptLinks';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({ links: await listLinks(id) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  if (!Array.isArray(body.ids))
    return NextResponse.json({ error: 'ids[] required' }, { status: 400 });
  await setLinks(id, body.ids);
  return NextResponse.json({ ok: true });
}
