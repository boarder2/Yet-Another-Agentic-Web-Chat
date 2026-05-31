import { getRun, subscribe } from '@/lib/runs/runHub';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache, no-transform',
};

const GONE_RESPONSE = JSON.stringify({ type: 'gone' }) + '\n';

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) => {
  const { messageId } = await params;
  const url = new URL(req.url);
  const from = parseInt(url.searchParams.get('from') ?? '0', 10) || 0;

  // Look up the run
  const run = getRun(messageId);

  // If run is not in the hub (evicted or server restarted), return gone
  if (!run) {
    return new Response(GONE_RESPONSE, {
      status: 200,
      headers: SSE_HEADERS,
    });
  }

  // Validate that the requesting chat owns this run
  const chatId = url.searchParams.get('chatId');
  if (chatId && chatId !== run.chatId) {
    return Response.json({ error: 'chatId mismatch' }, { status: 403 });
  }

  // Verify the chat row exists (guards against race with deletion)
  const chatRow = await db.query.chats.findFirst({
    where: eq(chats.id, run.chatId),
  });
  if (!chatRow) {
    return new Response(GONE_RESPONSE, {
      status: 200,
      headers: SSE_HEADERS,
    });
  }

  const subStream = subscribe(run, from, req.signal);
  return new Response(subStream.pipeThrough(new TextEncoderStream()), {
    headers: SSE_HEADERS,
  });
};
