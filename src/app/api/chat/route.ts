import { cleanupCancelToken } from '@/lib/cancel-tokens';
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
import { createSearchAgent } from '@/lib/search/deepAgentFactory';
import { getFileDetails } from '@/lib/utils/files';
import { getPersonaInstructionsOnly } from '@/lib/utils/prompts';
import { escapeAttribute } from '@/lib/utils/toolCallMarkup';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import crypto from 'crypto';
import { and, eq, gt } from 'drizzle-orm';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { buildMultimodalHumanMessage } from '@/lib/utils/images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Message = {
  messageId: string;
  chatId: string;
  content: string;
};

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

type Body = {
  message: Message;
  focusMode: string;
  history: Array<[string, string, string[]?]>;
  files: Array<string>;
  chatModel: ChatModel;
  systemModel?: SystemModel;
  embeddingModel: EmbeddingModel;
  selectedSystemPromptIds: string[];
  userLocation?: string;
  userProfile?: string;
  messageImageIds?: string[];
  messageImages?: Array<{
    imageId: string;
    fileName: string;
    mimeType: string;
  }>;
};
const handleHistorySave = async (
  message: Message,
  humanMessageId: string,
  focusMode: string,
  files: string[],
  messageImages?: Array<{
    imageId: string;
    fileName: string;
    mimeType: string;
  }>,
) => {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, message.chatId),
  });

  if (!chat) {
    await db
      .insert(chats)
      .values({
        id: message.chatId,
        title: message.content,
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
        content: message.content,
        chatId: message.chatId,
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
        content: message.content,
        metadata: JSON.stringify({
          createdAt: new Date(),
          ...(messageImages &&
            messageImages.length > 0 && { images: messageImages }),
        }),
      })
      .where(eq(messagesSchema.messageId, humanMessageId))
      .execute();
    await db
      .delete(messagesSchema)
      .where(
        and(
          gt(messagesSchema.id, messageExists.id),
          eq(messagesSchema.chatId, message.chatId),
        ),
      )
      .execute();
  }
};

export const POST = async (req: Request) => {
  try {
    const body = (await req.json()) as Body;
    const { message, selectedSystemPromptIds } = body;

    if (
      message.content === '' &&
      !(body.messageImageIds && body.messageImageIds.length > 0)
    ) {
      return Response.json(
        {
          message: 'Please provide a message to process',
        },
        { status: 400 },
      );
    }

    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    const chatModelProvider =
      chatModelProviders[
        body.chatModel?.provider || Object.keys(chatModelProviders)[0]
      ];
    const chatModel =
      chatModelProvider[
        body.chatModel?.name || Object.keys(chatModelProvider)[0]
      ];

    const embeddingProvider =
      embeddingModelProviders[
        body.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0]
      ];
    const embeddingModel =
      embeddingProvider[
        body.embeddingModel?.name || Object.keys(embeddingProvider)[0]
      ];

    let chatLlm: BaseChatModel | undefined;
    let systemLlm: BaseChatModel | undefined;
    const embedding = new CachedEmbeddings(
      embeddingModel.model,
      body.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0],
      body.embeddingModel?.name || Object.keys(embeddingProvider)[0],
    );

    if (body.chatModel?.provider === 'custom_openai') {
      chatLlm = new ChatOpenAI({
        apiKey: getCustomOpenaiApiKey(),
        modelName: getCustomOpenaiModelName(),
        configuration: {
          baseURL: getCustomOpenaiApiUrl(),
        },
      }) as unknown as BaseChatModel;
    } else if (chatModelProvider && chatModel) {
      chatLlm = chatModel.model;

      if (
        chatLlm instanceof ChatOllama &&
        body.chatModel?.provider === 'ollama'
      ) {
        chatLlm.numCtx = body.chatModel.ollamaContextWindow || 2048;
      }
    }

    if (body.systemModel) {
      const sysProvider = body.systemModel.provider;
      const sysName = body.systemModel.name;
      if (sysProvider === 'custom_openai') {
        systemLlm = new ChatOpenAI({
          apiKey: getCustomOpenaiApiKey(),
          modelName: getCustomOpenaiModelName(),
          configuration: {
            baseURL: getCustomOpenaiApiUrl(),
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

    if (!chatLlm) {
      return Response.json({ error: 'Invalid chat model' }, { status: 400 });
    }

    if (!embedding) {
      return Response.json(
        { error: 'Invalid embedding model' },
        { status: 400 },
      );
    }

    const humanMessageId =
      message.messageId ?? crypto.randomBytes(7).toString('hex');
    const aiMessageId = crypto.randomBytes(7).toString('hex');

    const history: BaseMessage[] = body.history.map((msg) => {
      if (msg[0] === 'human') {
        if (msg[2] && msg[2].length > 0) {
          return buildMultimodalHumanMessage(msg[1], msg[2]);
        }
        return new HumanMessage({ content: msg[1] });
      } else {
        return new AIMessage({ content: msg[1] });
      }
    });

    const personaInstructionsContent = await getPersonaInstructionsOnly(
      selectedSystemPromptIds || [],
    );

    let humanMessage: BaseMessage;
    if (body.messageImageIds && body.messageImageIds.length > 0) {
      humanMessage = buildMultimodalHumanMessage(
        message.content,
        body.messageImageIds,
      );
    } else {
      humanMessage = new HumanMessage({ content: message.content });
    }

    const agent = createSearchAgent({
      chatLlm: chatLlm!,
      systemLlm: systemLlm!,
      focusMode: body.focusMode,
      personaInstructions: personaInstructionsContent,
      messagesCount: history.length,
      query: message.content,
      userLocation: body.userLocation,
      userProfile: body.userProfile,
    });

    // Use a unique thread_id per request to avoid duplicate messages in checkpointer
    const requestThreadId = `${message.chatId}-${aiMessageId}`;
    const startTime = Date.now();

    // Stream the agent with SSE encoding - produces Uint8Array chunks in SSE format
    // that useStream's StreamManager can parse directly
    const sseStream = await agent.stream(
      { messages: [...history, humanMessage] },
      {
        encoding: 'text/event-stream',
        streamMode: ['updates', 'messages', 'custom'],
        configurable: {
          thread_id: requestThreadId,
          embeddings: embedding,
          systemLlm: systemLlm,
        },
      },
    );

    // Wrap the SSE stream in a ReadableStream, persisting AI message to DB when done
    const outputStream = new ReadableStream({
      async start(controller) {
        let closed = false;
        try {
          for await (const chunk of sseStream) {
            if (closed) break;
            controller.enqueue(chunk);
          }
        } catch (err) {
          const msg = String(err);
          if (!msg.includes('Controller is already closed')) {
            console.error('Agent stream error:', err);
          }
          if (!closed) {
            try {
              const errorEvent = `event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`;
              controller.enqueue(new TextEncoder().encode(errorEvent));
            } catch {
              // controller already closed
            }
          }
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed
            }
          }

          // Persist assistant message from checkpointer state
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const checkpoint = await (agent as any).getState({
              configurable: { thread_id: requestThreadId },
            });
            const cpMessages = checkpoint?.values?.messages;
            if (cpMessages && cpMessages.length > 0) {
              // Extract text content from ALL AI messages to preserve thinking content
              const extractMsgText = (msg: { content: unknown }): string => {
                if (typeof msg.content === 'string') return msg.content;
                if (Array.isArray(msg.content)) {
                  return msg.content
                    .filter(
                      (block: unknown) =>
                        typeof block === 'object' &&
                        block !== null &&
                        'text' in (block as Record<string, unknown>),
                    )
                    .map(
                      (block: unknown) =>
                        (block as { text: string }).text,
                    )
                    .join('');
                }
                return JSON.stringify(msg.content);
              };

              const textParts: string[] = [];
              for (const m of cpMessages) {
                if (
                  m._getType?.() === 'ai' ||
                  m.constructor?.name === 'AIMessage'
                ) {
                  const text = extractMsgText(m);
                  if (text) textParts.push(text);
                }
              }
              const rawContent = textParts.join('\n');

              // Build <ToolCall> markup from tool calls for persistence
              let toolCallMarkup = '';
              const toolResultIds = new Set<string>();
              for (const m of cpMessages) {
                if (
                  m._getType?.() === 'tool' ||
                  m.constructor?.name === 'ToolMessage'
                ) {
                  if (m.tool_call_id) toolResultIds.add(m.tool_call_id);
                }
              }
              for (const m of cpMessages) {
                if (
                  (m._getType?.() === 'ai' ||
                    m.constructor?.name === 'AIMessage') &&
                  m.tool_calls
                ) {
                  for (const tc of m.tool_calls) {
                    const status = toolResultIds.has(tc.id ?? '')
                      ? 'success'
                      : 'error';
                    const toolType = tc.name || 'unknown';
                    const toolCallId = tc.id || '';
                    const query = tc.args?.query as string | undefined;
                    const url = tc.args?.url as string | undefined;
                    let attrs = `type="${escapeAttribute(toolType)}" status="${status}" toolCallId="${escapeAttribute(toolCallId)}"`;
                    if (query) attrs += ` query="${escapeAttribute(query)}"`;
                    if (url) attrs += ` url="${escapeAttribute(url)}"`;
                    toolCallMarkup += `<ToolCall ${attrs}></ToolCall>\n`;
                  }
                }
              }

              const content = toolCallMarkup + rawContent;

              // Extract sources from tool result messages
              const sources: Array<Record<string, unknown>> = [];
              let searchQuery: string | undefined;
              const sourceRegex =
                /\[(\d+)\]\s+(.+?)\nURL:\s+(https?:\/\/[^\s\n]+)/g;
              for (const m of cpMessages) {
                if (
                  m._getType?.() === 'tool' ||
                  m.constructor?.name === 'ToolMessage'
                ) {
                  const toolContent =
                    typeof m.content === 'string'
                      ? m.content
                      : JSON.stringify(m.content);
                  let match;
                  while (
                    (match = sourceRegex.exec(toolContent)) !== null
                  ) {
                    sources.push({
                      sourceId: parseInt(match[1]),
                      title: match[2].trim(),
                      url: match[3].trim(),
                    });
                  }
                  // Extract search query from the corresponding AI tool call
                  if (!searchQuery && m.tool_call_id) {
                    for (const am of cpMessages) {
                      if (
                        (am._getType?.() === 'ai' ||
                          am.constructor?.name === 'AIMessage') &&
                        am.tool_calls
                      ) {
                        const tc = am.tool_calls.find(
                          (c: { id?: string }) => c.id === m.tool_call_id,
                        );
                        if (tc?.args?.query) {
                          searchQuery = tc.args.query;
                        }
                      }
                    }
                  }
                }
              }

              // Aggregate usage_metadata from all AI messages
              let totalInput = 0;
              let totalOutput = 0;
              let chatModelName = '';
              for (const m of cpMessages) {
                if (
                  m._getType?.() === 'ai' ||
                  m.constructor?.name === 'AIMessage'
                ) {
                  const usage = m.usage_metadata;
                  if (usage) {
                    totalInput += usage.input_tokens || 0;
                    totalOutput += usage.output_tokens || 0;
                  }
                  if (!chatModelName && m.response_metadata?.model) {
                    chatModelName = m.response_metadata.model;
                  }
                }
              }

              const endTime = Date.now();
              const modelStats =
                totalInput > 0 || totalOutput > 0
                  ? {
                      modelName: chatModelName || body.chatModel?.name || '',
                      responseTime: endTime - startTime,
                      usage: {
                        input_tokens: totalInput,
                        output_tokens: totalOutput,
                        total_tokens: totalInput + totalOutput,
                      },
                    }
                  : {
                      modelName: chatModelName || body.chatModel?.name || '',
                      responseTime: endTime - startTime,
                    };

              // Deduplicate sources by URL
              const seenUrls = new Set<string>();
              const dedupedSources = sources.filter((s) => {
                const url = s.url as string;
                if (seenUrls.has(url)) return false;
                seenUrls.add(url);
                return true;
              });

              await db
                .insert(messagesSchema)
                .values({
                  content,
                  chatId: message.chatId,
                  messageId: aiMessageId,
                  role: 'assistant',
                  metadata: JSON.stringify({
                    createdAt: new Date(),
                    ...(dedupedSources.length > 0 && {
                      sources: dedupedSources,
                    }),
                    ...(searchQuery && { searchQuery }),
                    modelStats,
                  }),
                })
                .execute();
            }
          } catch (dbErr) {
            console.error('Failed to persist assistant message:', dbErr);
          }

          cleanupCancelToken(message.messageId);
        }
      },
    });

    // Save the user message / chat history
    handleHistorySave(
      message,
      humanMessageId,
      body.focusMode,
      body.files,
      body.messageImages,
    );

    return new Response(outputStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    console.error('An error occurred while processing chat request:', err);
    return Response.json(
      { message: 'An error occurred while processing chat request' },
      { status: 500 },
    );
  }
};
