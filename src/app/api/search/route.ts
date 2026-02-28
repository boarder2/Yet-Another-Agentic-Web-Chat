import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { ChatOpenAI } from '@langchain/openai';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { createSearchAgent } from '@/lib/search/deepAgentFactory';
import { getPersonaInstructionsOnly } from '@/lib/utils/prompts';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { ChatOllama } from '@langchain/ollama';

interface chatModel {
  provider: string;
  name: string;
  customOpenAIKey?: string;
  customOpenAIBaseURL?: string;
  ollamaContextWindow?: number;
}
interface systemModel {
  provider: string;
  name: string;
  customOpenAIKey?: string;
  customOpenAIBaseURL?: string;
  ollamaContextWindow?: number;
}

interface embeddingModel {
  provider: string;
  name: string;
}

interface ChatRequestBody {
  focusMode: string;
  chatModel?: chatModel;
  systemModel?: systemModel; // optional; defaults to chat model when absent
  embeddingModel?: embeddingModel;
  query: string;
  history: Array<[string, string]>;
  stream?: boolean;
  selectedSystemPromptIds?: string[]; // legacy name; treated as persona prompt IDs
  userLocation?: string;
  userProfile?: string;
  messageImageIds?: string[];
}

export const POST = async (req: Request) => {
  try {
    const body: ChatRequestBody = await req.json();

    if (!body.focusMode || !body.query) {
      return Response.json(
        { message: 'Missing focus mode or query' },
        { status: 400 },
      );
    }

    body.history = body.history || [];
    body.stream = body.stream || false;

    const history: BaseMessage[] = body.history.map((msg) => {
      return msg[0] === 'human'
        ? new HumanMessage({ content: msg[1] })
        : new AIMessage({ content: msg[1] });
    });

    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    const chatModelProvider =
      body.chatModel?.provider || Object.keys(chatModelProviders)[0];
    const chatModel =
      body.chatModel?.name ||
      Object.keys(chatModelProviders[chatModelProvider])[0];

    const embeddingModelProvider =
      body.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0];
    const embeddingModel =
      body.embeddingModel?.name ||
      Object.keys(embeddingModelProviders[embeddingModelProvider])[0];

    let chatLlm: BaseChatModel | undefined;
    let systemLlm: BaseChatModel | undefined;
    let embeddings: CachedEmbeddings | undefined;

    if (body.chatModel?.provider === 'custom_openai') {
      chatLlm = new ChatOpenAI({
        modelName: body.chatModel?.name || getCustomOpenaiModelName(),
        apiKey: body.chatModel?.customOpenAIKey || getCustomOpenaiApiKey(),
        // temperature: 0.7,
        configuration: {
          baseURL:
            body.chatModel?.customOpenAIBaseURL || getCustomOpenaiApiUrl(),
        },
      }) as unknown as BaseChatModel;
    } else if (
      chatModelProviders[chatModelProvider] &&
      chatModelProviders[chatModelProvider][chatModel]
    ) {
      chatLlm = chatModelProviders[chatModelProvider][chatModel]
        .model as unknown as BaseChatModel | undefined;
    }

    if (
      chatLlm instanceof ChatOllama &&
      body.chatModel?.provider === 'ollama'
    ) {
      chatLlm.numCtx = body.chatModel.ollamaContextWindow || 2048;
    }

    // Build System LLM (defaults to Chat LLM if not provided)
    if (body.systemModel) {
      const sysProvider = body.systemModel.provider;
      const sysName = body.systemModel.name;
      if (sysProvider === 'custom_openai') {
        systemLlm = new ChatOpenAI({
          modelName: body.systemModel?.name || getCustomOpenaiModelName(),
          apiKey: body.systemModel?.customOpenAIKey || getCustomOpenaiApiKey(),
          configuration: {
            baseURL:
              body.systemModel?.customOpenAIBaseURL || getCustomOpenaiApiUrl(),
          },
        }) as unknown as BaseChatModel;
      } else if (
        chatModelProviders[sysProvider] &&
        chatModelProviders[sysProvider][sysName]
      ) {
        systemLlm = chatModelProviders[sysProvider][sysName]
          .model as unknown as BaseChatModel | undefined;
      }
      if (
        systemLlm instanceof ChatOllama &&
        body.systemModel?.provider === 'ollama'
      ) {
        systemLlm.numCtx = body.systemModel.ollamaContextWindow || 2048;
      }
    }
    if (!systemLlm) systemLlm = chatLlm;

    if (
      embeddingModelProviders[embeddingModelProvider] &&
      embeddingModelProviders[embeddingModelProvider][embeddingModel]
    ) {
      const rawEmbeddings = embeddingModelProviders[embeddingModelProvider][
        embeddingModel
      ].model as Embeddings | undefined;

      if (rawEmbeddings) {
        embeddings = new CachedEmbeddings(
          rawEmbeddings,
          embeddingModelProvider,
          embeddingModel,
        );
      }
    }

    if (!chatLlm || !embeddings || !systemLlm) {
      return Response.json(
        { message: 'Invalid model selected' },
        { status: 400 },
      );
    }

    const validFocusModes = ['webSearch', 'localResearch', 'chat'];
    if (!validFocusModes.includes(body.focusMode)) {
      return Response.json({ message: 'Invalid focus mode' }, { status: 400 });
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    req.signal.addEventListener('abort', () => {
      if (!abortController.signal.aborted) {
        console.log('Search API: Client disconnected, aborting processing');
        abortController.abort();
      }
    });

    const personaInstructions = await getPersonaInstructionsOnly(
      body.selectedSystemPromptIds || [],
    );

    const agent = createSearchAgent({
      chatLlm,
      systemLlm,
      focusMode: body.focusMode,
      personaInstructions,
      messagesCount: history.length,
      query: body.query,
      userLocation: body.userLocation,
      userProfile: body.userProfile,
    });

    const humanMessage = new HumanMessage({ content: body.query });
    const input = { messages: [...history, humanMessage] };
    const configurable = {
      embeddings,
      systemLlm,
      signal,
      thread_id: `search-${Date.now()}`,
    };

    if (!body.stream) {
      try {
        let message = '';
        let sources: Record<string, unknown>[] = [];

        const eventStream = agent.streamEvents(
          input,
          { version: 'v2', configurable },
        );

        const activeAgentLlmRunIds = new Set<string>();

        for await (const event of eventStream) {
          if (signal.aborted) break;

          if (
            event.event === 'on_chat_model_start' &&
            event.metadata?.langgraph_node === 'model_request'
          ) {
            activeAgentLlmRunIds.add(event.run_id);
          }

          if (
            event.event === 'on_chat_model_stream' &&
            event.data.chunk &&
            activeAgentLlmRunIds.has(event.run_id)
          ) {
            const content = event.data.chunk.content;
            if (typeof content === 'string') {
              message += content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if ((block.type === 'text' || block.type === 'text_delta') && block.text) {
                  message += block.text;
                }
              }
            }
          }

          if (event.event === 'on_chat_model_end') {
            activeAgentLlmRunIds.delete(event.run_id);
          }

          if (event.event === 'on_custom_event' && event.name === 'sources') {
            const eventData = event.data as { sources?: Record<string, unknown>[] };
            if (eventData.sources) sources = eventData.sources;
          }
        }

        return Response.json({ message, sources }, { status: 200 });
      } catch (error) {
        return Response.json(
          { message: 'Search error', error: String(error) },
          { status: 500 },
        );
      }
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let isStreamActive = true;

        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: 'init', data: 'Stream connected' }) + '\n',
          ),
        );

        const pingInterval = setInterval(() => {
          if (isStreamActive && !signal.aborted) {
            try {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ type: 'ping', timestamp: Date.now() }) + '\n',
                ),
              );
            } catch {
              clearInterval(pingInterval);
              isStreamActive = false;
            }
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);

        signal.addEventListener('abort', () => {
          isStreamActive = false;
          clearInterval(pingInterval);
          try { controller.close(); } catch { /* already closed */ }
        });

        try {
          const eventStream = agent.streamEvents(
            input,
            { version: 'v2', configurable },
          );

          const activeAgentLlmRunIds = new Set<string>();

          for await (const event of eventStream) {
            if (!isStreamActive || signal.aborted) break;

            if (
              event.event === 'on_chat_model_start' &&
              event.metadata?.langgraph_node === 'model_request'
            ) {
              activeAgentLlmRunIds.add(event.run_id);
            }

            if (
              event.event === 'on_chat_model_stream' &&
              event.data.chunk &&
              activeAgentLlmRunIds.has(event.run_id)
            ) {
              const content = event.data.chunk.content;
              let text = '';
              if (typeof content === 'string') text = content;
              else if (Array.isArray(content)) {
                for (const block of content) {
                  if ((block.type === 'text' || block.type === 'text_delta') && block.text) {
                    text += block.text;
                  }
                }
              }
              if (text) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ type: 'response', data: text }) + '\n',
                  ),
                );
              }
            }

            if (event.event === 'on_chat_model_end') {
              activeAgentLlmRunIds.delete(event.run_id);
            }

            if (event.event === 'on_custom_event' && event.name === 'sources') {
              const eventData = event.data as { sources?: Record<string, unknown>[] };
              if (eventData.sources) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ type: 'sources', data: eventData.sources }) + '\n',
                  ),
                );
              }
            }
          }

          if (isStreamActive) {
            isStreamActive = false;
            clearInterval(pingInterval);
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: 'done' }) + '\n'),
            );
            controller.close();
          }
        } catch (error) {
          isStreamActive = false;
          clearInterval(pingInterval);
          controller.error(error);
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    console.error(
      `Error in getting search results: ${err instanceof Error ? err.message : String(err)}`,
    );
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
