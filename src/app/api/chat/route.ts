import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import db from '@/lib/db';
import { chats, messages as messagesSchema } from '@/lib/db/schema';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { getFileDetails } from '@/lib/utils/files';
import { getPersonaInstructionsOnly } from '@/lib/utils/prompts';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import crypto from 'crypto';
// Configure global undici dispatcher with no body timeout to support slow local LLMs
// (default undici bodyTimeout of 5 min is too short for 35B+ models)
import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ bodyTimeout: 0, headersTimeout: 0 }));
import { and, asc, eq, gt } from 'drizzle-orm';
import {
  registerRetrieval,
  cleanupRun,
  clearSoftStop,
} from '@/lib/utils/runControl';
import { registerCancelToken, cleanupCancelToken } from '@/lib/cancel-tokens';
import { buildMultimodalHumanMessage } from '@/lib/utils/images';
import { createAgent } from '@/lib/agent/factory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatModel = {
  provider: string;
  name: string;
  ollamaContextWindow?: number;
};
type SystemModel = {
  provider: string;
  name: string;
  ollamaContextWindow?: number;
};
type EmbeddingModel = {
  provider: string;
  name: string;
};

// Body format sent by FetchStreamTransport from useStream.submit()
type FetchStreamBody = {
  input?: {
    messages?: Array<{ role: string; content: string; id?: string }>;
  };
  config?: {
    configurable?: {
      thread_id?: string; // chatId
      focusMode?: string;
      chatModel?: ChatModel;
      systemModel?: SystemModel;
      embeddingModel?: EmbeddingModel;
      selectedSystemPromptIds?: string[];
      userLocation?: string;
      userProfile?: string;
      files?: string[];
      fileIds?: string[];
      messageImageIds?: string[];
      messageImages?: Array<{
        imageId: string;
        fileName: string;
        mimeType: string;
      }>;
      humanMessageId?: string; // user message ID for DB dedup/edit + respond-now
    };
  };
};

type ModelStats = {
  modelNameChat?: string;
  modelNameSystem?: string;
  responseTime?: number;
  usedLocation?: boolean;
  usedPersonalization?: boolean;
};

// Serialize a LangChain message object to a flat dict for SSE output.
// useStream reads stream.values.messages and expects: { type, id, content, tool_calls, ... }
// LangChain .toDict() yields { type, data: { content, ... } } — the nested `data` format
// is NOT understood by useStream, so we flatten it here.
function serializeLCMessage(m: unknown): unknown {
  if (m && typeof m === 'object') {
    const msg = m as Record<string, unknown>;
    if (typeof msg.toDict === 'function') {
      const dict = msg.toDict() as Record<string, unknown>;
      const data = (dict.data as Record<string, unknown>) ?? {};
      // Return flat format that useStream and FetchStreamTransport understand
      return {
        type: dict.type,
        id: data.id ?? msg.id,
        content: data.content ?? msg.content ?? '',
        additional_kwargs: data.additional_kwargs ?? {},
        response_metadata: data.response_metadata ?? {},
        tool_calls: data.tool_calls ?? [],
        tool_call_id: data.tool_call_id,
        name: data.name,
      };
    }
  }
  return m;
}

// Serialize a stream chunk for SSE output.
// The 'values' mode contains LangChain BaseMessage objects in the messages array.
// The 'messages' mode chunks are already plain dicts (LangGraph serializes them).
// All other modes emit plain objects.
function serializeChunk(mode: string, chunk: unknown): string {
  if (mode === 'values' && chunk !== null && typeof chunk === 'object') {
    const c = chunk as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(c)) {
      if (key === 'messages' && Array.isArray(value)) {
        result[key] = value.map(serializeLCMessage);
      } else {
        result[key] = value;
      }
    }
    return JSON.stringify(result);
  }
  return JSON.stringify(chunk);
}

const handleHistorySave = async (
  chatId: string,
  humanMessageId: string,
  humanContent: string,
  focusMode: string,
  files: string[],
  messageImages?: Array<{
    imageId: string;
    fileName: string;
    mimeType: string;
  }>,
) => {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat) {
    await db
      .insert(chats)
      .values({
        id: chatId,
        title: humanContent,
        createdAt: new Date().toString(),
        focusMode: focusMode,
        files: files.map(getFileDetails),
      })
      .execute();
  }

  const messageExists = await db.query.messages.findFirst({
    where: eq(messagesSchema.messageId, humanMessageId),
  });

  if (!messageExists) {
    await db
      .insert(messagesSchema)
      .values({
        content: humanContent,
        chatId: chatId,
        messageId: humanMessageId,
        role: 'user',
        metadata: JSON.stringify({
          createdAt: new Date(),
          ...(messageImages &&
            messageImages.length > 0 && { images: messageImages }),
        }),
      })
      .execute();
  } else {
    await db
      .update(messagesSchema)
      .set({
        content: humanContent,
        metadata: JSON.stringify({
          createdAt: new Date(),
          ...(messageImages &&
            messageImages.length > 0 && { images: messageImages }),
        }),
      })
      .where(eq(messagesSchema.messageId, humanMessageId))
      .execute();
    // Delete messages that came after this one (edit scenario)
    await db
      .delete(messagesSchema)
      .where(
        and(
          gt(messagesSchema.id, messageExists.id),
          eq(messagesSchema.chatId, chatId),
        ),
      )
      .execute();
  }
};

export const POST = async (req: Request) => {
  try {
    const startTime = Date.now();
    const body = (await req.json()) as FetchStreamBody;

    const input = body.input ?? {};
    const configurable = body.config?.configurable ?? {};

    const {
      thread_id: chatId,
      focusMode = 'webSearch',
      chatModel: chatModelSpec,
      systemModel: systemModelSpec,
      embeddingModel: embeddingModelSpec,
      selectedSystemPromptIds = [],
      userLocation,
      userProfile,
      files = [],
      fileIds,
      messageImageIds,
      messageImages,
      humanMessageId: requestedHumanMessageId,
    } = configurable;

    // Extract the new human message from input
    const inputMessages = input.messages ?? [];
    const lastInputMessage = inputMessages[inputMessages.length - 1];
    const humanContent = lastInputMessage?.content ?? '';

    if (!chatId) {
      return Response.json(
        { error: 'Missing thread_id (chatId)' },
        { status: 400 },
      );
    }

    if (!humanContent && !(messageImageIds && messageImageIds.length > 0)) {
      return Response.json(
        { error: 'Please provide a message to process' },
        { status: 400 },
      );
    }

    const humanMessageId =
      requestedHumanMessageId ?? crypto.randomBytes(7).toString('hex');
    const aiMessageId = crypto.randomBytes(7).toString('hex');

    // Build LLMs
    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    const chatModelProvider =
      chatModelProviders[
        chatModelSpec?.provider || Object.keys(chatModelProviders)[0]
      ];
    const chatModelDef =
      chatModelProvider?.[
        chatModelSpec?.name || Object.keys(chatModelProvider ?? {})[0]
      ];

    const embeddingProvider =
      embeddingModelProviders[
        embeddingModelSpec?.provider || Object.keys(embeddingModelProviders)[0]
      ];
    const embeddingModelDef =
      embeddingProvider?.[
        embeddingModelSpec?.name || Object.keys(embeddingProvider ?? {})[0]
      ];

    let chatLlm: BaseChatModel | undefined;
    let systemLlm: BaseChatModel | undefined;

    const embedding = embeddingModelDef
      ? new CachedEmbeddings(
          embeddingModelDef.model,
          embeddingModelSpec?.provider ||
            Object.keys(embeddingModelProviders)[0],
          embeddingModelSpec?.name || Object.keys(embeddingProvider ?? {})[0],
        )
      : undefined;

    if (chatModelSpec?.provider === 'custom_openai') {
      chatLlm = new ChatOpenAI({
        apiKey: getCustomOpenaiApiKey(),
        modelName: getCustomOpenaiModelName(),
        configuration: { baseURL: getCustomOpenaiApiUrl() },
      }) as unknown as BaseChatModel;
    } else if (chatModelProvider && chatModelDef) {
      chatLlm = chatModelDef.model;
      if (
        chatLlm instanceof ChatOllama &&
        chatModelSpec?.provider === 'ollama'
      ) {
        chatLlm.numCtx = chatModelSpec.ollamaContextWindow || 2048;
      }
    }

    // Build System LLM (defaults to Chat LLM if not specified)
    if (systemModelSpec) {
      const sysProvider = systemModelSpec.provider;
      const sysName = systemModelSpec.name;
      if (sysProvider === 'custom_openai') {
        systemLlm = new ChatOpenAI({
          apiKey: getCustomOpenaiApiKey(),
          modelName: getCustomOpenaiModelName(),
          configuration: { baseURL: getCustomOpenaiApiUrl() },
        }) as unknown as BaseChatModel;
      } else if (
        chatModelProviders[sysProvider] &&
        chatModelProviders[sysProvider][sysName]
      ) {
        systemLlm = chatModelProviders[sysProvider][sysName]
          .model as unknown as BaseChatModel;
      }
      if (
        systemLlm instanceof ChatOllama &&
        systemModelSpec.provider === 'ollama'
      ) {
        systemLlm.numCtx = systemModelSpec.ollamaContextWindow || 2048;
      }
    }
    if (!systemLlm) systemLlm = chatLlm;

    if (!chatLlm) {
      return Response.json({ error: 'Invalid chat model' }, { status: 400 });
    }
    if (!embedding) {
      return Response.json(
        { error: 'Invalid embedding model' },
        { status: 400 },
      );
    }

    // Persona instructions
    const personaInstructionsContent = await getPersonaInstructionsOnly(
      selectedSystemPromptIds || [],
    );

    // Build personalization section for system prompt
    let personalizationSection = '';
    if (userLocation) {
      personalizationSection += `<userLocation>\n${userLocation}\n</userLocation>\n`;
    }
    if (userProfile) {
      personalizationSection += `<userProfile>\n${userProfile}\n</userProfile>\n`;
    }

    // Setup cancellation
    const abortController = new AbortController();
    registerCancelToken(humanMessageId, abortController);
    const retrievalController = new AbortController();
    registerRetrieval(humanMessageId, retrievalController);
    clearSoftStop(humanMessageId);

    req.signal.addEventListener('abort', () => {
      if (!abortController.signal.aborted) {
        retrievalController.abort();
        abortController.abort();
      }
    });

    abortController.signal.addEventListener('abort', () => {
      if (!retrievalController.signal.aborted) {
        retrievalController.abort();
      }
      cleanupCancelToken(humanMessageId);
      cleanupRun(humanMessageId);
    });

    // Save user message first (ensures edit truncation before history load)
    await handleHistorySave(
      chatId,
      humanMessageId,
      humanContent,
      focusMode,
      files,
      messageImages,
    );

    // Load chat history from DB
    const dbMessages = await db.query.messages.findMany({
      where: eq(messagesSchema.chatId, chatId),
      orderBy: [asc(messagesSchema.id)],
    });

    // Build LangChain message history from DB records
    const historyMessages = dbMessages.map((m) => {
      if (m.role === 'user') {
        const meta = m.metadata as Record<string, unknown> | null;
        const images = meta?.images as
          | Array<{ imageId: string; fileName: string; mimeType: string }>
          | undefined;
        if (images && images.length > 0) {
          return buildMultimodalHumanMessage(
            m.content,
            images.map((img) => img.imageId),
          );
        }
        return new HumanMessage({ content: m.content });
      }
      return new AIMessage({ content: m.content });
    });

    // The last DB record is the user message we just saved (plain text).
    // Replace it with the full (possibly multimodal) message object.
    const currentMessage =
      messageImageIds && messageImageIds.length > 0
        ? buildMultimodalHumanMessage(humanContent, messageImageIds)
        : new HumanMessage({ content: humanContent });

    const historyWithoutCurrentMsg =
      dbMessages.length > 0 &&
      dbMessages[dbMessages.length - 1].messageId === humanMessageId
        ? historyMessages.slice(0, -1)
        : historyMessages;

    const allMessages = [...historyWithoutCurrentMsg, currentMessage];

    // Create agent per-request (supports dynamic model + personalization)
    const agent = createAgent({
      focusMode,
      chatLlm,
      fileIds: fileIds ?? files,
      messagesCount: dbMessages.length,
      query: humanContent,
      personaInstructions: personaInstructionsContent,
      personalizationSection,
      checkpointer: new MemorySaver(),
    });

    // Monotonic sequence counter for event ordering
    let eventSeq = 0;

    // Setup SSE response stream
    const responseStream = new TransformStream<Uint8Array, Uint8Array>();
    const sseWriter = responseStream.writable.getWriter();
    let isStreamActive = true;
    let writerClosed = false;

    const safeWrite = (data: string) => {
      if (!isStreamActive || writerClosed || abortController.signal.aborted)
        return;
      const bytes = new TextEncoder().encode(data);
      sseWriter.write(bytes).catch(() => {
        if (!isStreamActive) return;
        isStreamActive = false;
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      });
    };

    const safeClose = () => {
      if (writerClosed) return;
      writerClosed = true;
      sseWriter.close().catch(() => {});
    };

    abortController.signal.addEventListener('abort', () => {
      isStreamActive = false;
      safeClose();
    });

    // Inject event metadata (__threadId, __streamId, __seq) into any data object
    const injectEventMeta = (
      data: Record<string, unknown>,
      streamId: string,
    ): Record<string, unknown> => ({
      ...data,
      __threadId: chatId,
      __streamId: streamId,
      __seq: eventSeq++,
    });

    // Write an SSE event with metadata injected into the data payload
    const writeEvent = (
      event: string,
      data: Record<string, unknown>,
      streamId: string,
    ) => {
      safeWrite(
        `event: ${event}\ndata: ${JSON.stringify(injectEventMeta(data, streamId))}\n\n`,
      );
    };

    // Write an agent-stream event, using serializeChunk then injecting metadata
    const writeStreamEvent = (
      event: string,
      mode: string,
      chunk: unknown,
      streamId: string,
    ) => {
      const serialized = JSON.parse(serializeChunk(mode, chunk));
      let withMeta: unknown;

      if (mode === 'messages' && Array.isArray(serialized)) {
        // messages mode produces [serializedMessage, metadata] arrays.
        // Inject event metadata into the metadata object (second element)
        // to preserve the array structure that useStream expects.
        const [msg, meta, ...rest] = serialized;
        withMeta = [
          msg,
          {
            ...(meta && typeof meta === 'object' ? meta : {}),
            __threadId: chatId,
            __streamId: streamId,
            __seq: eventSeq++,
          },
          ...rest,
        ];
      } else if (
        typeof serialized === 'object' &&
        serialized !== null &&
        !Array.isArray(serialized)
      ) {
        withMeta = injectEventMeta(
          serialized as Record<string, unknown>,
          streamId,
        );
      } else {
        withMeta = injectEventMeta({ __data: serialized }, streamId);
      }

      safeWrite(`event: ${event}\ndata: ${JSON.stringify(withMeta)}\n\n`);
    };

    // Keep-alive pings to prevent reverse proxy timeouts
    const pingInterval = setInterval(() => {
      if (isStreamActive && !abortController.signal.aborted) {
        writeEvent('metadata', { ping: Date.now() }, aiMessageId);
      } else {
        clearInterval(pingInterval);
      }
    }, 25000);

    // Run the agent stream asynchronously
    (async () => {
      let finalValues: Record<string, unknown> | null = null;
      let sources: unknown[] = [];
      let searchQuery: string | undefined;

      // Per-request thread ID for LangGraph (MemorySaver scope)
      const perRequestThreadId = `${chatId}:${aiMessageId}`;

      // Emit initial metadata so useStream captures thread/run IDs
      writeEvent(
        'metadata',
        { run_id: aiMessageId, thread_id: perRequestThreadId },
        aiMessageId,
      );

      try {
        const agentStream = await agent.stream(
          { messages: allMessages },
          {
            streamMode: ['custom', 'messages', 'values'],
            subgraphs: true,
            signal: abortController.signal,
            configurable: {
              thread_id: perRequestThreadId,
              systemLlm,
              embeddings: embedding,
              fileIds: fileIds ?? files,
              messageId: humanMessageId,
              retrievalSignal: retrievalController.signal,
            },
          },
        );

        for await (const item of agentStream) {
          if (abortController.signal.aborted) break;

          // With streamMode array + subgraphs: true → [ns, mode, chunk] tuple
          const [ns, mode, chunk] = item as [string[], string, unknown];

          const event = ns && ns.length > 0 ? `${mode}|${ns.join('|')}` : mode;

          // Collect root-namespace events for DB persistence
          if (!ns || ns.length === 0) {
            if (mode === 'values') {
              finalValues = chunk as Record<string, unknown>;
            } else if (mode === 'custom') {
              const c = chunk as Record<string, unknown> | null;
              if (c?.type === 'sources_added' && Array.isArray(c.data)) {
                sources = c.data;
                if (typeof c.searchQuery === 'string') {
                  searchQuery = c.searchQuery;
                }
              }
            }
          }

          const streamId = ns && ns.length > 0 ? ns.join(':') : aiMessageId;
          writeStreamEvent(event, mode, chunk, streamId);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            err.name === 'CanceledError' ||
            // undici body timeout or fetch termination from slow local models
            (err.name === 'TypeError' && errMsg === 'terminated') ||
            (err as { code?: string }).code === 'UND_ERR_BODY_TIMEOUT' ||
            // LM Studio may unload model during long requests
            errMsg.includes('Model unloaded'));
        if (isAbort) {
          // Cancelled, timed out, or model unloaded — close stream without emitting an error event
          console.warn('Agent stream ended early:', errMsg);
        } else {
          console.error('Agent stream error:', err);
          const msg = err instanceof Error ? err.message : 'Unknown error';
          writeEvent('error', { error: 'Error', message: msg }, aiMessageId);
        }
      } finally {
        clearInterval(pingInterval);

        const endTime = Date.now();
        const modelStats: ModelStats = {
          modelNameChat: chatModelSpec?.name ?? '',
          modelNameSystem: systemModelSpec?.name ?? chatModelSpec?.name ?? '',
          responseTime: endTime - startTime,
          usedLocation: !!(userLocation && userLocation.length > 0),
          usedPersonalization: !!(userProfile && userProfile.length > 0),
        };

        // Emit completion event for the frontend
        writeEvent(
          'custom',
          {
            type: 'messageEnd',
            messageId: aiMessageId,
            humanMessageId,
            chatId,
            modelStats,
            searchQuery,
          },
          aiMessageId,
        );

        isStreamActive = false;
        safeClose();
        cleanupCancelToken(humanMessageId);
        cleanupRun(humanMessageId);

        // Persist AI response to DB
        if (!abortController.signal.aborted && finalValues) {
          try {
            const msgs = (finalValues.messages as unknown[]) ?? [];
            let lastAiContent = '';

            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i] as Record<string, unknown>;
              const serialized = serializeLCMessage(m) as Record<
                string,
                unknown
              >;
              const mType = serialized.type ?? serialized.role;
              if (mType === 'ai' || mType === 'assistant') {
                // .toDict() nests fields under `data`; plain objects have content at top-level
                const data =
                  (serialized.data as Record<string, unknown> | undefined) ??
                  serialized;
                const content = data.content;
                if (typeof content === 'string') {
                  lastAiContent = content;
                } else if (Array.isArray(content)) {
                  lastAiContent = (
                    content as Array<{ type?: string; text?: string }>
                  )
                    .filter((c) => c?.type === 'text')
                    .map((c) => c.text ?? '')
                    .join('');
                }
                break;
              }
            }

            if (lastAiContent && lastAiContent.trim().length > 0) {
              await db
                .insert(messagesSchema)
                .values({
                  content: lastAiContent,
                  chatId: chatId,
                  messageId: aiMessageId,
                  role: 'assistant',
                  metadata: JSON.stringify({
                    createdAt: new Date(),
                    ...(sources.length > 0 && { sources }),
                    ...(searchQuery && { searchQuery }),
                    modelStats,
                  }),
                })
                .execute();
            }
          } catch (dbErr) {
            console.error('Failed to save AI message to DB:', dbErr);
          }
        }
      }
    })();

    return new Response(responseStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    console.error('An error occurred while processing chat request:', err);
    return Response.json(
      { error: 'An error occurred while processing chat request' },
      { status: 500 },
    );
  }
};
