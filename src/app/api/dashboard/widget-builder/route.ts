import { NextRequest } from 'next/server';
import { EventEmitter } from 'events';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';
import {
  resolveChatAndEmbedding,
  ModelRef,
} from '@/lib/providers/resolveModels';
import { widgetBuilderSystemPrompt } from '@/lib/prompts/simplifiedAgent/widgetBuilder';
import {
  createWidgetBuilderTools,
  WidgetBuilderState,
} from '@/lib/tools/agents/widgetBuilderTools';
import { allAgentTools } from '@/lib/tools/agents';
import { WidgetTheme } from '@/lib/types/widget';

interface WidgetBuilderRequest {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  widget: WidgetBuilderState;
  revision: number;
  lastError?: string;
  autoAccept?: boolean;
  theme?: WidgetTheme;
  chatModel?: ModelRef;
  systemModel?: ModelRef;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};

export async function POST(req: NextRequest) {
  let body: WidgetBuilderRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.message || !body.widget) {
    return Response.json(
      { error: 'Missing required fields: message, widget' },
      { status: 400 },
    );
  }

  const { chatLlm, systemLlm, embedding } = await resolveChatAndEmbedding({
    chatModel: body.chatModel,
    systemModel: body.systemModel,
  });

  const ctx = {
    state: body.widget,
    revision: body.revision ?? 0,
    previewBudget: { remaining: 5 },
    autoAccept: body.autoAccept ?? false,
    theme: body.theme,
  };
  const tools = createWidgetBuilderTools(ctx);

  // Inject the current state + latest error into the turn so the agent always
  // grounds on what the user is looking at (multi-turn build / repair).
  const customSystemPrompt = [
    widgetBuilderSystemPrompt,
    '\n## Current widget state',
    `Title: ${body.widget.title || '(untitled)'}`,
    `Sources: ${
      body.widget.sources.length
        ? body.widget.sources
            .map((s, i) => `[${i}] ${s.type} ${s.url}`)
            .join('; ')
        : '(none)'
    }`,
    `Code:\n\`\`\`js\n${body.widget.code}\n\`\`\``,
    body.lastError
      ? `\n## Latest preview/refresh error\n\`\`\`\n${body.lastError}\n\`\`\``
      : '',
    body.autoAccept
      ? '\n## Auto-apply is ENABLED\nEvery change you propose is applied to the working copy and previewed automatically — there is NO manual approval step this turn. Speak as if your edits take effect immediately ("I\'ve updated…"), and never ask the user to approve/accept. You will be sent any preview error to fix.'
      : '',
  ].join('\n');

  const history: BaseMessage[] = (body.history ?? []).map((m) =>
    m.role === 'user'
      ? new HumanMessage({ content: m.content })
      : new AIMessage({ content: m.content }),
  );

  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort());
  const emitter = new EventEmitter();

  const agent = new SimplifiedAgent(
    chatLlm,
    systemLlm,
    embedding,
    emitter,
    '',
    abortController.signal,
    `widget-builder-${Date.now()}`,
    abortController.signal,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: string) =>
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));

      emitter.on('data', send);
      emitter.on('stats', send);
      emitter.once('end', () => {
        send(JSON.stringify({ type: 'end' }));
        emitter.removeAllListeners();
        try {
          controller.close();
        } catch {}
      });
      emitter.once('error', (e: unknown) => {
        send(JSON.stringify({ type: 'error', data: String(e) }));
        emitter.removeAllListeners();
        try {
          controller.close();
        } catch {}
      });

      // Tool allowlist is enforced server-side: we only ever pass our 4 tools.
      // Cast to satisfy the agent's tool array type.
      agent
        .searchAndAnswer(
          body.message,
          history,
          [],
          'chat',
          tools as unknown as typeof allAgentTools,
          customSystemPrompt,
        )
        .catch((e) => {
          send(JSON.stringify({ type: 'error', data: String(e) }));
          try {
            controller.close();
          } catch {}
        });
    },
    cancel() {
      abortController.abort();
      emitter.removeAllListeners();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
