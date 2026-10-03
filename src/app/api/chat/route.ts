import { subscribe } from '@/lib/runs/runHub';
import { startChatTurn, type ChatTurnRequest } from '@/lib/chat/startTurn';
import { getRequestClock } from '@/lib/clock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache, no-transform',
};

export const POST = async (req: Request) => {
  try {
    const result = await startChatTurn(
      (await req.json()) as ChatTurnRequest,
      getRequestClock(req),
    );
    if (!('run' in result)) {
      return Response.json(result.body, { status: result.status });
    }
    const subStream = subscribe(result.run, 0, req.signal);
    return new Response(subStream.pipeThrough(new TextEncoderStream()), {
      headers: SSE_HEADERS,
    });
  } catch (err) {
    console.error('An error occurred while processing chat request:', err);
    return Response.json(
      { message: 'An error occurred while processing chat request' },
      { status: 500 },
    );
  }
};
