import { createHash } from 'crypto';
import { z } from 'zod';
import { SearchProvider, WebSearchOpts } from './types';

const ENDPOINT = 'https://search.parallel.ai/mcp';
const PROTOCOL_VERSION = '2025-03-26';
const USER_AGENT =
  'YAAWC/2.0.0 (+https://github.com/boarder2/Yet-Another-Agentic-Web-Chat)';

const rpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
const toolSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});
const searchSchema = z.object({
  results: z.array(
    z.object({
      url: z.url(),
      title: z.string().nullable().optional(),
      excerpts: z.array(z.string()),
    }),
  ),
});

function matchingRpc(value: unknown, id: number) {
  const parsed = rpcSchema.safeParse(value);
  if (!parsed.success || parsed.data.id !== id) return null;
  if (parsed.data.error) {
    throw new Error(`Parallel: ${parsed.data.error.message}`);
  }
  return parsed.data;
}

// Streamable HTTP can return JSON or SSE. Stop at our response even if an
// SSE connection remains open, and ignore unrelated server notifications.
async function readRpc(response: Response, id: number): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const rpc = matchingRpc(await response.json(), id);
    if (rpc) return rpc.result;
    throw new Error('Parallel returned an invalid MCP response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Parallel returned an empty MCP response');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const rpc = matchingRpc(JSON.parse(data), id);
        if (rpc) return rpc.result;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error('Parallel returned an invalid MCP response');
}

export const parallelProvider: SearchProvider = {
  id: 'parallel',
  displayName: 'Parallel',
  capabilities: {
    web: true,
    images: false,
    videos: false,
    autocomplete: false,
  },
  async webSearch(query: string, opts?: WebSearchOpts, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(30_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    requestSignal.throwIfAborted();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': USER_AGENT,
    };
    let session: string | null = null;
    const post = async (body: object) => {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', ...body }),
        signal: requestSignal,
      });
      if (!response.ok) {
        throw new Error(`Parallel returned HTTP ${response.status}`);
      }
      return response;
    };

    try {
      const initialized = await post({
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'yaawc', version: '2.0.0' },
        },
      });
      session = initialized.headers.get('mcp-session-id');
      if (session) headers['Mcp-Session-Id'] = session;
      const info = z
        .object({ protocolVersion: z.literal(PROTOCOL_VERSION) })
        .parse(await readRpc(initialized, 1));
      headers['MCP-Protocol-Version'] = info.protocolVersion;
      await post({ method: 'notifications/initialized' });

      const response = toolSchema.parse(
        await readRpc(
          await post({
            id: 2,
            method: 'tools/call',
            params: {
              name: 'web_search',
              arguments: {
                objective: query,
                search_queries: [query],
                ...(opts?.sessionId && {
                  session_id: createHash('sha256')
                    .update(opts.sessionId)
                    .digest('hex'),
                }),
              },
            },
          }),
          2,
        ),
      );
      const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text ?? '')
        .join('\n');
      if (response.isError) throw new Error(`Parallel: ${text}`);
      const data = searchSchema.parse(
        response.structuredContent ?? JSON.parse(text),
      );
      return {
        results: data.results.map((result) => ({
          title: result.title || result.url,
          url: result.url,
          content: result.excerpts.join('\n\n'),
        })),
      };
    } finally {
      if (session) {
        // Closing a session is best-effort, including after caller cancellation.
        await fetch(ENDPOINT, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(2_000),
        }).catch(() => {});
      }
    }
  },
};
