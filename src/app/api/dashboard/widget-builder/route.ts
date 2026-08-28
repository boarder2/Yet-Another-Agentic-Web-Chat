import { NextRequest } from 'next/server';
import { EventEmitter } from 'events';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';
import { createTurnTracker } from '@/lib/tokens/tracker';
import { onStreamEvent } from '@/lib/streaming/events';
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
import { createAgentRunConfig } from '@/lib/search/agentRunConfig';

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

  // Widget builder doesn't surface a token-usage popover, but SimplifiedAgent
  // requires a tracker to attribute any LLM calls it makes.
  const unknownModel = { provider: 'unknown', name: 'unknown' };
  const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
    emitter,
    body.chatModel ?? unknownModel,
    body.systemModel ?? body.chatModel ?? unknownModel,
  );

  const agentMessageId = `widget-builder-${Date.now()}`;
  const runConfig = createAgentRunConfig({
    chatModelRef: body.chatModel ?? unknownModel,
    systemModelRef: body.systemModel ?? body.chatModel ?? unknownModel,
    focusMode: 'chat',
    fileIds: [],
    personaInstructions: '',
    methodologyInstructions: '',
    userLocation: null,
    userProfile: null,
    workspaceId: null,
    isPrivate: false,
    chatId: null,
    messageId: agentMessageId,
    aiMessageId: null,
    interactiveSession: false,
    workspaceSuffix: '',
    memoryEnabled: false,
    panel: null,
    mappingAvailable: false,
    mappingSavedLocationEnabled: false,
  });
  const agent = new SimplifiedAgent({
    dependencies: {
      chatLlm,
      systemLlm,
      embeddings: embedding,
      emitter,
      tokenTracking: { tracker, chatRecorder, systemRecorder },
    },
    run: runConfig,
    context: {
      signal: abortController.signal,
      retrievalSignal: abortController.signal,
      memorySection: '',
      invokedSkillNames: [],
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );

      onStreamEvent(emitter, (event) => {
        if (event.type === 'agent_end') {
          send({ type: 'end' });
          emitter.removeAllListeners();
          try {
            controller.close();
          } catch {}
        } else if (event.type === 'agent_error') {
          send({ type: 'error', data: event.data });
          emitter.removeAllListeners();
          try {
            controller.close();
          } catch {}
        } else {
          // Forward the agent's own events (response, widget_proposal, …).
          send(event);
        }
      });

      // Tool allowlist is enforced server-side: we only ever pass our 4 tools.
      // Cast to satisfy the agent's tool array type.
      agent
        .searchAndAnswer({
          query: body.message,
          history,
          customTools: tools as unknown as typeof allAgentTools,
          customSystemPrompt,
        })
        .catch((e) => {
          send({ type: 'error', data: String(e) });
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
