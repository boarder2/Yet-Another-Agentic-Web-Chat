import {
  resumeRun,
  resumeRunMulti,
  StaleSnapshotError,
  RaceError,
  RunGoneError,
} from '@/lib/runs/runHost';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      approvalId?: string;
      response?: unknown;
      resumeMap?: Record<string, unknown>;
    };

    // Parallel interrupts: { resumeMap: { approvalId: response, ... } }
    if (body.resumeMap && Object.keys(body.resumeMap).length > 0) {
      await resumeRunMulti(body.resumeMap);
      return Response.json({ ok: true });
    }

    if (!body.approvalId) {
      return Response.json(
        { error: 'approvalId or resumeMap is required' },
        { status: 400 },
      );
    }

    await resumeRun(body.approvalId, body.response ?? null);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RaceError) {
      return Response.json({ error: (err as Error).message }, { status: 409 });
    }
    if (err instanceof StaleSnapshotError) {
      return Response.json({ error: (err as Error).message }, { status: 409 });
    }
    if (err instanceof RunGoneError) {
      return Response.json({ error: (err as Error).message }, { status: 410 });
    }
    console.error('[/api/chat/runs/resume] error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
