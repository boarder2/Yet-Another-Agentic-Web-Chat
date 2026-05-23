import { NextResponse } from 'next/server';
import { resolveEditApproval } from '@/lib/skills/pendingEdits';
import type { EditDecision } from '@/lib/skills/pendingEdits';

export async function POST(req: Request) {
  try {
    const { approvalId, decision, freeformText } = await req.json();

    if (!approvalId || !decision) {
      return NextResponse.json(
        { error: 'approvalId and decision are required' },
        { status: 400 },
      );
    }

    const validDecisions: EditDecision[] = [
      'accept',
      'accept_always',
      'reject',
      'always_prompt',
    ];
    if (!validDecisions.includes(decision)) {
      return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
    }

    const resolved = resolveEditApproval(
      approvalId,
      decision as EditDecision,
      freeformText,
    );

    if (!resolved) {
      return NextResponse.json(
        { error: 'Approval not found or already resolved' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/skills/pending-edit] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to resolve approval' },
      { status: 500 },
    );
  }
}
