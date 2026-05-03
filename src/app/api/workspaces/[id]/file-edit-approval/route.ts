import { NextRequest, NextResponse } from 'next/server';
import {
  resolveEditApproval,
  EditDecision,
} from '@/lib/workspaces/pendingEdits';
import { getWorkspace } from '@/lib/workspaces/service';

const VALID_DECISIONS = new Set<string>([
  'accept',
  'accept_always',
  'reject',
  'always_prompt',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ws = await getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { approvalId, decision, freeformText } = body;

  if (typeof approvalId !== 'string' || !approvalId) {
    return NextResponse.json({ error: 'approvalId required' }, { status: 400 });
  }

  if (!VALID_DECISIONS.has(decision)) {
    return NextResponse.json({ error: 'invalid decision' }, { status: 400 });
  }

  const resolved = resolveEditApproval(
    approvalId,
    decision as EditDecision,
    typeof freeformText === 'string' ? freeformText : undefined,
  );

  if (!resolved) {
    return NextResponse.json(
      { error: 'approval not found or already resolved' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
