import { getRun } from '@/lib/runs/runHub';
import { enqueueSteer, removeSteer } from '@/lib/runs/steering';

export const runtime = 'nodejs';

/** Queue a steer on the live run keyed by its user `messageId`. */
export async function POST(req: Request) {
  const { messageId, content } = (await req.json().catch(() => ({}))) as {
    messageId?: unknown;
    content?: unknown;
  };
  if (typeof messageId !== 'string' || typeof content !== 'string') {
    return Response.json(
      { error: 'messageId and content are required' },
      { status: 400 },
    );
  }
  if (!content.trim()) {
    return Response.json({ error: 'Steer is empty' }, { status: 400 });
  }
  const run = getRun(messageId);
  const steer = run ? enqueueSteer(run, content.trim()) : null;
  if (!steer) {
    return Response.json(
      { error: 'The agent is no longer accepting steering messages.' },
      { status: 409 },
    );
  }
  return Response.json({ steerId: steer.id });
}

/** Withdraw a steer the agent has not received yet. */
export async function DELETE(req: Request) {
  const { messageId, steerId } = (await req.json().catch(() => ({}))) as {
    messageId?: unknown;
    steerId?: unknown;
  };
  if (typeof messageId !== 'string' || typeof steerId !== 'string') {
    return Response.json(
      { error: 'messageId and steerId are required' },
      { status: 400 },
    );
  }
  const run = getRun(messageId);
  if (!run || !removeSteer(run, steerId)) {
    return Response.json(
      { error: 'This message was already sent to the agent.' },
      { status: 409 },
    );
  }
  return new Response(null, { status: 204 });
}
