import { NextRequest, NextResponse } from 'next/server';
import { checkReachable } from '@/lib/workspaces/sourceUrls';

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (typeof body.url !== 'string')
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  return NextResponse.json(await checkReachable(body.url));
}
