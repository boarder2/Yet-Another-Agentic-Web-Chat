import { NextResponse } from 'next/server';
import { resolveApproval } from '@/lib/sandbox/pendingApprovals';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json();
  const { executionId, approved } = body;

  if (
    !executionId ||
    typeof executionId !== 'string' ||
    typeof approved !== 'boolean'
  ) {
    return NextResponse.json(
      { error: 'executionId (string) and approved (boolean) are required' },
      { status: 400 },
    );
  }

  const found = resolveApproval(executionId, approved);

  if (!found) {
    return NextResponse.json(
      { error: 'Execution not found or already resolved' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
