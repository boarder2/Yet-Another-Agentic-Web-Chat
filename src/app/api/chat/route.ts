import { updateToolCallMarkup } from '@/lib/utils/toolCallMarkup';
import { encodeHtmlAttribute } from '@/lib/utils/html';
import { cleanupCancelToken, registerCancelToken } from '@/lib/cancel-tokens';
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
import { getFileDetails } from '@/lib/utils/files';
import { getPersonaInstructionsOnly } from '@/lib/utils/prompts';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import crypto from 'crypto';
import { and, eq, gt } from 'drizzle-orm';
import { EventEmitter } from 'stream';
import {
  registerRetrieval,
  cleanupRun,
  clearSoftStop,
} from '@/lib/utils/runControl';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { buildMultimodalHumanMessage } from '@/lib/utils/images';
import { retrieveRelevantMemories } from '@/lib/utils/memoryRetrieval';
import { buildMemorySection } from '@/lib/prompts/memory/memoryContext';
import { processExtraction } from '@/lib/utils/memoryExtraction';
import { denyApprovalsForMessage } from '@/lib/sandbox/pendingApprovals';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';

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
  systemModel?: SystemModel; // optional; defaults to chatModel
  embeddingModel: EmbeddingModel;
  selectedSystemPromptIds: string[]; // legacy name; treated as persona prompt IDs
  userLocation?: string;
  userProfile?: string;
  messageImageIds?: string[];
  messageImages?: Array<{
    imageId: string;
    fileName: string;
    mimeType: string;
  }>;
  memoryEnabled?: boolean;
  memoryAutoDetection?: boolean;
  isPrivate?: boolean;
};

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};
type ModelStats = {
  modelName: string; // legacy
  responseTime?: number;
  usage?: TokenUsage; // legacy total
  modelNameChat?: string;
  modelNameSystem?: string;
  usageChat?: TokenUsage;
  usageSystem?: TokenUsage;
  usedLocation?: boolean;
  usedPersonalization?: boolean;
};

const handleEmitterEvents = async (
  stream: EventEmitter,
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  aiMessageId: string,
  chatId: string,
  startTime: number,
  userMessageId: string,
  abortController: AbortController,
  usedLocation: boolean,
  usedPersonalization: boolean,
  memoriesUsed: Array<{ id: string; content: string }> = [],
) => {
  let recievedMessage = '';
  // Map executionId → runId for correlating code_execution_result with the correct ToolCall markup
  const codeExecutionRunIdMap = new Map<string, string>();
  let sources: Record<string, unknown>[] = [];
  let searchQuery: string | undefined;
  let searchUrl: string | undefined;
  let isStreamActive = true;
  let writerClosed = false;

  // Helper to safely write to the stream; aborts processing if the client has disconnected
  const safeWrite = (data: string) => {
    if (!isStreamActive || writerClosed || abortController.signal.aborted)
      return;
    writer.write(encoder.encode(data)).catch(() => {
      if (!isStreamActive) return;
      isStreamActive = false;
      if (!abortController.signal.aborted) {
        console.log('Write failed (client disconnected), aborting processing');
        abortController.abort();
      }
    });
  };

  const safeClose = () => {
    if (writerClosed) return;
    writerClosed = true;
    writer.close().catch(() => {});
  };

  // Keep-alive ping mechanism to prevent reverse proxy timeouts
  const pingInterval = setInterval(() => {
    if (isStreamActive && !abortController.signal.aborted) {
      safeWrite(
        JSON.stringify({
          type: 'ping',
          timestamp: Date.now(),
        }) + '\n',
      );
    } else {
      clearInterval(pingInterval);
    }
  }, 30000); // Send ping every 30 seconds

  // Clean up ping interval if request is cancelled
  abortController.signal.addEventListener('abort', () => {
    isStreamActive = false;
    clearInterval(pingInterval);
    // Auto-deny any pending code execution approvals for this message
    denyApprovalsForMessage(userMessageId);
  });

  stream.on('data', (data) => {
    if (!isStreamActive || abortController.signal.aborted) return;
    const parsedData = JSON.parse(data);

    if (parsedData.type === 'response') {
      safeWrite(
        JSON.stringify({
          type: 'response',
          data: parsedData.data,
          messageId: aiMessageId,
        }) + '\n',
      );

      recievedMessage += parsedData.data;
    } else if (
      parsedData.type === 'sources' ||
      parsedData.type === 'sources_added'
    ) {
      // Capture the search query if available
      if (parsedData.searchQuery) {
        searchQuery = parsedData.searchQuery;
      }
      if (parsedData.searchUrl) {
        searchUrl = parsedData.searchUrl;
      }

      safeWrite(
        JSON.stringify({
          type: parsedData.type,
          data: parsedData.data,
          searchQuery: parsedData.searchQuery,
          messageId: aiMessageId,
          searchUrl: searchUrl,
        }) + '\n',
      );

      sources = parsedData.data;
    } else if (
      parsedData.type === 'tool_call_started' ||
      parsedData.type === 'tool_call_success' ||
      parsedData.type === 'tool_call_error'
    ) {
      // Forward new granular tool lifecycle events
      safeWrite(
        JSON.stringify({
          type: parsedData.type,
          data: parsedData.data,
          messageId: aiMessageId,
        }) + '\n',
      );
      if (parsedData.type === 'tool_call_started' && parsedData.data?.content) {
        // Append initial placeholder markup to message content for persistence
        recievedMessage += parsedData.data.content;
      } else if (
        parsedData.type === 'tool_call_success' ||
        parsedData.type === 'tool_call_error'
      ) {
        // Rewrite existing ToolCall tag with final status (and error if applicable)
        recievedMessage = updateToolCallMarkup(
          recievedMessage,
          parsedData.data.toolCallId,
          {
            status: parsedData.data.status,
            error: parsedData.data.error,
            extra: parsedData.data.extra,
          },
        );
      }
    } else if (
      parsedData.type === 'subagent_started' ||
      parsedData.type === 'subagent_completed' ||
      parsedData.type === 'subagent_error' ||
      parsedData.type === 'subagent_data'
    ) {
      // Forward subagent events to client
      // console.log('API: Forwarding subagent event:', parsedData.type);
      safeWrite(
        JSON.stringify({
          ...parsedData,
          messageId: aiMessageId,
        }) + '\n',
      );

      // Update received message for persistence if needed
      if (parsedData.type === 'subagent_started') {
        const markup = `<SubagentExecution id="${parsedData.executionId}" name="${encodeHtmlAttribute(parsedData.name ?? '')}" task="${encodeHtmlAttribute(parsedData.task ?? '')}" status="running"></SubagentExecution>\n`;
        recievedMessage += markup;
      } else if (parsedData.type === 'subagent_data') {
        // Persist nested tool call markup inside SubagentExecution tags
        const nestedEvent = parsedData.data;
        const executionId = parsedData.subagentId;

        if (
          nestedEvent?.type === 'tool_call_started' &&
          nestedEvent.data?.content
        ) {
          // Insert ToolCall markup inside the SubagentExecution tag
          const subagentRegex = new RegExp(
            `(<SubagentExecution\\s+id="${executionId}"[^>]*>)(.*?)(</SubagentExecution>)`,
            'gs',
          );
          recievedMessage = recievedMessage.replace(
            subagentRegex,
            (match, openTag, content, closeTag) => {
              return `${openTag}${content}${nestedEvent.data.content}\n${closeTag}`;
            },
          );
        } else if (
          nestedEvent?.type === 'tool_call_success' &&
          nestedEvent.data?.toolCallId
        ) {
          recievedMessage = updateToolCallMarkup(
            recievedMessage,
            nestedEvent.data.toolCallId,
            { status: 'success' },
          );
        } else if (
          nestedEvent?.type === 'tool_call_error' &&
          nestedEvent.data?.toolCallId
        ) {
          recievedMessage = updateToolCallMarkup(
            recievedMessage,
            nestedEvent.data.toolCallId,
            {
              status: 'error',
              error: nestedEvent.data.error,
            },
          );
        }
      } else if (
        parsedData.type === 'subagent_completed' ||
        parsedData.type === 'subagent_error'
      ) {
        // Update the SubagentExecution markup in received message
        const status =
          parsedData.type === 'subagent_completed' ? 'success' : 'error';
        const executionId = parsedData.id;
        const subagentRegex = new RegExp(
          `<SubagentExecution\\s+id="${executionId}"([^>]*)>(.*?)<\\/SubagentExecution>`,
          'gs',
        );
        recievedMessage = recievedMessage.replace(
          subagentRegex,
          (match, attrs, innerContent) => {
            let updatedAttrs = attrs
              .replace(/status="[^"]*"/, `status="${status}"`)
              .trim();
            if (!updatedAttrs.includes('status=')) {
              updatedAttrs += ` status="${status}"`;
            }
            if (parsedData.summary && status === 'success') {
              const escapedSummary = parsedData.summary
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
              updatedAttrs += ` summary="${escapedSummary}"`;
            }
            if (parsedData.error && status === 'error') {
              const escapedError = parsedData.error
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
              updatedAttrs += ` error="${escapedError}"`;
            }
            // Preserve inner content (ToolCall markup)
            return `<SubagentExecution ${updatedAttrs}>${innerContent}</SubagentExecution>`;
          },
        );
      }
    } else if (parsedData.type === 'todo_update') {
      // Forward todo_update event to client (transient UI, not persisted in message)
      safeWrite(
        JSON.stringify({
          type: 'todo_update',
          data: parsedData.data,
          messageId: aiMessageId,
        }) + '\n',
      );
    } else if (parsedData.type === 'code_execution_pending') {
      // Correlate this execution with the ToolCall markup's toolCallId
      // (provided by codeExecutionCorrelation module via markupToolCallId).
      const runId = parsedData.data?.markupToolCallId;
      if (runId && parsedData.data?.executionId) {
        codeExecutionRunIdMap.set(parsedData.data.executionId, runId);
      }
      // Forward code execution pending event to client
      safeWrite(
        JSON.stringify({
          type: parsedData.type,
          data: parsedData.data,
          messageId: aiMessageId,
        }) + '\n',
      );
    } else if (parsedData.type === 'code_execution_result') {
      // Forward to client
      safeWrite(
        JSON.stringify({
          type: parsedData.type,
          data: parsedData.data,
          messageId: aiMessageId,
        }) + '\n',
      );
      // Persist result data in ToolCall markup
      // Look up the correct runId for this execution from the correlation map
      const tcId =
        codeExecutionRunIdMap.get(parsedData.data?.executionId) ||
        parsedData.data?.toolCallId;
      if (tcId) {
        const d = parsedData.data;
        const extra: Record<string, string> = {};
        if (d.exitCode !== undefined) extra.exitCode = String(d.exitCode);
        if (d.stdout) extra.stdout = d.stdout.slice(0, 2000);
        if (d.stderr) extra.stderr = d.stderr.slice(0, 1000);
        if (d.timedOut) extra.timedOut = 'true';
        if (d.oomKilled) extra.oomKilled = 'true';
        if (d.denied) extra.denied = 'true';
        recievedMessage = updateToolCallMarkup(recievedMessage, tcId, {
          extra,
        });
      }
    }
  });

  let modelStats: ModelStats = {
    modelName: '',
  };

  stream.on('progress', (data) => {
    if (!isStreamActive || abortController.signal.aborted) return;
    const parsedData = JSON.parse(data);
    if (parsedData.type === 'progress') {
      safeWrite(
        JSON.stringify({
          type: 'progress',
          data: parsedData.data,
          messageId: aiMessageId,
        }) + '\n',
      );
    }
  });

  stream.on('stats', (data) => {
    if (!isStreamActive || abortController.signal.aborted) return;
    const parsedData = JSON.parse(data);
    if (parsedData.type === 'modelStats') {
      modelStats = {
        ...parsedData.data,
        usedLocation,
        usedPersonalization,
      };
      // Forward stats to client for live updates
      safeWrite(
        JSON.stringify({
          type: 'stats',
          data: modelStats,
          messageId: aiMessageId,
        }) + '\n',
      );
    }
  });

  stream.on('end', () => {
    clearInterval(pingInterval);

    const endTime = Date.now();
    const duration = endTime - startTime;

    modelStats = {
      ...modelStats,
      responseTime: duration,
      usedLocation,
      usedPersonalization,
    };

    safeWrite(
      JSON.stringify({
        type: 'messageEnd',
        messageId: aiMessageId,
        modelStats: modelStats,
        searchQuery: searchQuery,
        searchUrl: searchUrl,
        usedLocation,
        usedPersonalization,
        memoriesUsed: memoriesUsed.length > 0 ? memoriesUsed : undefined,
      }) + '\n',
    );
    isStreamActive = false;
    safeClose();

    // Clean up the abort controller reference
    cleanupCancelToken(userMessageId);

    db.insert(messagesSchema)
      .values({
        content: recievedMessage,
        chatId: chatId,
        messageId: aiMessageId,
        role: 'assistant',
        metadata: JSON.stringify({
          createdAt: new Date(),
          ...(sources && sources.length > 0 && { sources }),
          ...(searchQuery && { searchQuery }),
          modelStats: modelStats,
          ...(searchUrl && { searchUrl }),
          usedLocation,
          usedPersonalization,
          ...(memoriesUsed.length > 0 && { memoriesUsed }),
        }),
      })
      .execute();
  });
  stream.on('error', (data) => {
    clearInterval(pingInterval);

    const parsedData = JSON.parse(data);
    safeWrite(
      JSON.stringify({
        type: 'error',
        data: parsedData.data,
      }),
    );
    isStreamActive = false;
    safeClose();
  });
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
  isPrivate?: boolean,
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
        isPrivate: isPrivate ? 1 : 0,
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
    const startTime = Date.now();
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
        // temperature: 0.7,
        configuration: {
          baseURL: getCustomOpenaiApiUrl(),
        },
      }) as unknown as BaseChatModel;
    } else if (chatModelProvider && chatModel) {
      chatLlm = chatModel.model;

      // Set context window size for Ollama models
      if (
        chatLlm instanceof ChatOllama &&
        body.chatModel?.provider === 'ollama'
      ) {
        chatLlm.numCtx = body.chatModel.ollamaContextWindow || 2048;
      }
    }

    // Build System LLM (defaults to Chat LLM if not provided by client)
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
      if (msg[0] === 'human' || msg[0] === 'user') {
        // If this history entry has image IDs, build a multimodal message
        if (msg[2] && msg[2].length > 0) {
          return buildMultimodalHumanMessage(msg[1], msg[2]);
        }
        return new HumanMessage({
          content: msg[1],
        });
      } else {
        return new AIMessage({
          content: msg[1],
        });
      }
    });

    // System instructions deprecated; only use persona prompts
    const personaInstructionsContent = await getPersonaInstructionsOnly(
      selectedSystemPromptIds || [],
    );
    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();

    // --- Cancellation logic ---
    const abortController = new AbortController();
    registerCancelToken(message.messageId, abortController);

    // Register retrieval-only controller and clear soft-stop at start
    const retrievalController = new AbortController();
    registerRetrieval(message.messageId, retrievalController);
    clearSoftStop(message.messageId);

    // Detect client disconnection via the request's built-in abort signal
    req.signal.addEventListener('abort', () => {
      if (!abortController.signal.aborted) {
        console.log('Client disconnected, aborting all processing');
        retrievalController.abort();
        abortController.abort();
      }
    });

    abortController.signal.addEventListener('abort', () => {
      console.log('Stream aborted, sending cancel event');
      // Also abort retrieval to stop LangGraph agent processing
      if (!retrievalController.signal.aborted) {
        retrievalController.abort();
      }
      writer
        .write(
          encoder.encode(
            JSON.stringify({
              type: 'error',
              data: 'Request cancelled by user',
            }),
          ),
        )
        .catch(() => {});
      writer.close().catch(() => {});
      cleanupCancelToken(message.messageId);
      cleanupRun(message.messageId);
    });

    // --- Privacy mode: strip personalization/memory server-side ---
    if (body.isPrivate) {
      body.userLocation = undefined;
      body.userProfile = undefined;
      body.memoryEnabled = false;
      body.memoryAutoDetection = false;
    }

    // --- Memory retrieval ---
    let memorySection = '';
    let memoriesUsed: Array<{ id: string; content: string }> = [];

    if (body.memoryEnabled) {
      try {
        const relevantMemories = await retrieveRelevantMemories(
          message.content,
          embedding,
        );
        if (relevantMemories.length > 0) {
          memorySection = buildMemorySection(relevantMemories);
          memoriesUsed = relevantMemories.map((m) => ({
            id: m.id,
            content: m.content,
          }));
        }
      } catch (err) {
        console.warn(
          'Memory retrieval failed, continuing without memories:',
          err,
        );
      }
    }

    const stream = new EventEmitter();

    const handler = new SimplifiedAgent(
      chatLlm,
      systemLlm!,
      embedding,
      stream,
      personaInstructionsContent,
      abortController.signal,
      message.messageId,
      retrievalController.signal,
      body.userLocation,
      body.userProfile,
      body.memoryEnabled,
      memorySection,
      message.chatId,
      true, // interactiveSession enabled for streaming responses with source updates
    );

    // Pass the abort signal to the search handler
    // Not awaited since the handler will manage its own lifecycle and emit events as data is processed
    handler.searchAndAnswer(
      message.content,
      history,
      body.files,
      body.focusMode,
      undefined, // customTools
      undefined, // customSystemPrompt
      body.messageImageIds,
    );

    handleEmitterEvents(
      stream,
      writer,
      encoder,
      aiMessageId,
      message.chatId,
      startTime,
      message.messageId,
      abortController,
      body.userLocation ? body.userLocation.length > 0 : false,
      body.userProfile ? body.userProfile.length > 0 : false,
      memoriesUsed,
    );

    // Post-response automatic memory extraction (fire-and-forget)
    if (body.memoryAutoDetection && systemLlm) {
      stream.on('end', () => {
        processExtraction(
          message.content,
          '', // assistant response text is captured in handleEmitterEvents
          systemLlm!,
          embedding,
          message.chatId,
        )
          .then((result) => {
            if (result.saved > 0 || result.updated > 0) {
              // Emit memory_updated event if the writer is hopefully still accessible
              try {
                const memoryEvent =
                  JSON.stringify({
                    type: 'memory_updated',
                    data: {
                      saved: result.saved,
                      updated: result.updated,
                      memoryIds: result.memories.map((m) => m.id),
                    },
                  }) + '\n';
                writer.write(encoder.encode(memoryEvent)).catch(() => {});
              } catch {
                // Writer already closed, log the result
                console.log(
                  `Memory extraction: ${result.saved} saved, ${result.updated} updated`,
                );
              }
            }
            if (result.blocked > 0) {
              console.log(
                `Memory extraction: ${result.blocked} blocked (sensitive content)`,
              );
            }
          })
          .catch((err) => {
            console.warn('Post-response memory extraction failed:', err);
          });
      });
    }

    handleHistorySave(
      message,
      humanMessageId,
      body.focusMode,
      body.files,
      body.messageImages,
      body.isPrivate,
    );

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
      { message: 'An error occurred while processing chat request' },
      { status: 500 },
    );
  }
};
