import { NextRequest, NextResponse } from 'next/server';
import { getUrls, setUrls } from '@/lib/workspaces/sourceUrls';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({ urls: await getUrls(id) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  if (!Array.isArray(body.urls))
    return NextResponse.json({ error: 'urls[] required' }, { status: 400 });
  try {
    const ws = await setUrls(id, body.urls);
    return NextResponse.json({ urls: ws?.sourceUrls ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
