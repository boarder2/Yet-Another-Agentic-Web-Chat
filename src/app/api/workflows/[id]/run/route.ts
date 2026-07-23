import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { workflows } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { startWorkflowRun } from '@/lib/workflows/runManual';
import { RequiredInputsError } from '@/lib/workflows/resolveWorkflowRun';

export const runtime = 'nodejs';

// Manual run (§7.1): re-parse + re-validate required server-side (closes the
// tamper/stale gap), substitute, then hand off into the normal interactive run
// so the seeded chat is live and continuable. Returns the new chatId.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const values = (body?.values ?? {}) as Record<string, string | string[]>;

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });
  if (!workflow) return Response.json({ error: 'Not found' }, { status: 404 });

  try {
    const { chatId } = await startWorkflowRun(workflow, values);
    return Response.json({ chatId }, { status: 201 });
  } catch (err) {
    if (err instanceof RequiredInputsError) {
      return Response.json(
        { error: 'Missing required inputs', missing: err.missing },
        { status: 400 },
      );
    }
    const message =
      err instanceof Error ? err.message : 'Failed to run workflow';
    return Response.json({ error: message }, { status: 500 });
  }
}
