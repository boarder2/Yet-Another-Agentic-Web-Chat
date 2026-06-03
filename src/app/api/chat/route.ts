import { registerCancelToken } from '@/lib/cancel-tokens';
import db from '@/lib/db';
import { chats, messages as messagesSchema, workspaces } from '@/lib/db/schema';
import { getChatMessages, getCompactionRows } from '@/lib/db/queries';
import { resolveChatAndEmbedding } from '@/lib/providers/resolveModels';
import { getFileDetails } from '@/lib/utils/files';
import {
  getPersonaInstructionsOnly,
  getMethodologyInstructions,
} from '@/lib/utils/prompts';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { buildHistoryFromDb } from '@/lib/utils/buildHistory';
import crypto from 'crypto';
import { and, eq, gte } from 'drizzle-orm';
import { EventEmitter } from 'stream';
import { registerRetrieval, clearSoftStop } from '@/lib/utils/runControl';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { retrieveRelevantMemories } from '@/lib/utils/memoryRetrieval';
import { buildMemorySection } from '@/lib/prompts/memory/memoryContext';
import { processExtraction } from '@/lib/utils/memoryExtraction';
import { distillQueryForEmbedding } from '@/lib/utils/queryDistillation';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';
import { buildWorkspaceSystemPromptSuffix } from '@/lib/workspaces/composeSystemPrompt';
import { workspaceLsTool } from '@/lib/tools/workspace/ls';
import { workspaceGrepTool } from '@/lib/tools/workspace/grep';
import { workspaceReadTool } from '@/lib/tools/workspace/read';
import { workspaceEditTool } from '@/lib/tools/workspace/edit';
import { workspaceCreateFileTool } from '@/lib/tools/workspace/create';
import { resolveSkillsForChat, getByName } from '@/lib/skills/resolve';
import { SKILL_TOKEN_SCAN_REGEX } from '@/lib/skills/validation';
import { persistToolContextRow } from '@/lib/utils/persistToolContext';
import {
  startRun,
  getRun,
  subscribe,
  pushEvent,
  evictByChatId,
} from '@/lib/runs/runHub';
import { attachRunHost } from '@/lib/runs/runHost';

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
  contextWindowSize?: number;
};
type SystemModel = {
  provider: string;
  name: string;
  contextWindowSize?: number;
};

type EmbeddingModel = {
  provider: string;
  name: string;
};

type Body = {
  message: Message;
  focusMode: string;
  files: Array<string>;
  chatModel: ChatModel;
  systemModel?: SystemModel; // optional; defaults to chatModel
  embeddingModel: EmbeddingModel;
  selectedSystemPromptIds: string[]; // legacy name; treated as persona prompt IDs
  selectedMethodologyId?: string;
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
  workspaceId?: string | null;
  imageCapable?: boolean;
  invokedSkills?: string[];
};

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
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
  workspaceId?: string | null,
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
        createdAt: Date.now(),
        focusMode: focusMode,
        files: files.map(getFileDetails),
        isPrivate: isPrivate ? 1 : 0,
        workspaceId: workspaceId ?? null,
      })
      .execute();
  }

  const messageExists = await db.query.messages.findFirst({
    where: eq(messagesSchema.messageId, humanMessageId),
  });

  if (messageExists) {
    // Edit equals nuke-and-rebuild from that point. Drops the edited user
    // row, any newer assistant/system rows, and any compaction checkpoints
    // whose summarized region the edit invalidates.
    await db
      .delete(messagesSchema)
      .where(
        and(
          eq(messagesSchema.chatId, message.chatId),
          gte(messagesSchema.id, messageExists.id),
        ),
      )
      .execute();
  }

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
};

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache, no-transform',
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

    const humanMessageId =
      message.messageId ?? crypto.randomBytes(7).toString('hex');

    // Fast-path idempotency: if this messageId already has a live run, re-subscribe
    // instead of starting a duplicate. Covers both an in-flight run and one paused
    // at an interrupt (awaiting_user) — a resubmit of the same message must not
    // orphan the paused checkpoint/approvals by overwriting the run.
    const existingRun = getRun(humanMessageId);
    if (
      existingRun &&
      (existingRun.status === 'running' ||
        existingRun.status === 'awaiting_user')
    ) {
      const subStream = subscribe(existingRun, 0, req.signal);
      return new Response(subStream.pipeThrough(new TextEncoderStream()), {
        headers: SSE_HEADERS,
      });
    }

    let chatLlm: BaseChatModel | undefined;
    let systemLlm: BaseChatModel | undefined;
    let embedding: CachedEmbeddings;

    try {
      const resolved = await resolveChatAndEmbedding({
        chatModel: body.chatModel,
        systemModel: body.systemModel,
        embeddingModel: body.embeddingModel,
      });
      chatLlm = resolved.chatLlm;
      systemLlm = resolved.systemLlm;
      embedding = resolved.embedding;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid model';
      return Response.json({ error: msg }, { status: 400 });
    }

    const aiMessageId = crypto.randomBytes(7).toString('hex');

    // System instructions deprecated; only use persona prompts
    const personaInstructionsContent = await getPersonaInstructionsOnly(
      selectedSystemPromptIds || [],
    );
    const methodologyInstructions = await getMethodologyInstructions(
      body.selectedMethodologyId ?? null,
    );

    // --- Cancellation logic ---
    const abortController = new AbortController();
    registerCancelToken(message.messageId, abortController);

    // Register retrieval-only controller and clear soft-stop at start
    const retrievalController = new AbortController();
    registerRetrieval(message.messageId, retrievalController);
    clearSoftStop(message.messageId);

    // Note: req.signal no longer aborts the run — client disconnect only
    // removes the subscriber from the fan-out set. Cancel via POST /api/chat/cancel.

    // --- Privacy mode: strip personalization/memory server-side ---
    if (body.isPrivate) {
      body.userLocation = undefined;
      body.userProfile = undefined;
      body.memoryEnabled = false;
      body.memoryAutoDetection = false;
    }

    // --- Workspace context (load early so workspaceId is available for memory scoping) ---
    // Load workspaceId from the CHAT RECORD (authoritative), not the request body.
    // For a new chat the row is created in handleHistorySave (fire-and-forget below),
    // so fall back to body.workspaceId only for the very first message.
    let resolvedWorkspaceId: string | null = null;
    let resolvedWorkspace: typeof workspaces.$inferSelect | null = null;
    {
      const existingChat = await db.query.chats.findFirst({
        where: eq(chats.id, message.chatId),
      });
      resolvedWorkspaceId =
        existingChat?.workspaceId ?? body.workspaceId ?? null;
      if (resolvedWorkspaceId) {
        resolvedWorkspace =
          (await db.query.workspaces.findFirst({
            where: eq(workspaces.id, resolvedWorkspaceId),
          })) ?? null;
      }
    }

    // --- Memory retrieval ---
    let memorySection = '';
    let memoriesUsed: Array<{ id: string; content: string }> = [];
    let distillationUsage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    if (body.memoryEnabled) {
      try {
        // Distill long queries before embedding to avoid exceeding model token limits.
        // Short queries are returned unchanged with zero usage.
        let queryForEmbedding = message.content;
        if (systemLlm) {
          const distillResult = await distillQueryForEmbedding(
            message.content,
            systemLlm,
            abortController.signal,
          );
          queryForEmbedding = distillResult.query;
          distillationUsage = distillResult.usage;
          if (distillResult.usage.total_tokens > 0) {
            console.log(
              `[memoryRetrieval] Query distilled (${message.content.length} → ${queryForEmbedding.length} chars), tokens input: ${distillResult.usage.input_tokens}, tokens output: ${distillResult.usage.output_tokens}, total tokens: ${distillResult.usage.total_tokens}\nDistilled query: "${queryForEmbedding}"`,
            );
          }
        }

        const relevantMemories = await retrieveRelevantMemories(
          queryForEmbedding,
          embedding,
          { workspaceId: resolvedWorkspaceId },
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

    let workspaceSuffix = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workspaceExtraTools: any[] = [];
    if (resolvedWorkspaceId) {
      try {
        workspaceSuffix = await buildWorkspaceSystemPromptSuffix({
          workspaceId: resolvedWorkspaceId,
          focusMode: body.focusMode,
        });

        const visionCapable = !!body.imageCapable;
        workspaceExtraTools.push(
          workspaceLsTool(resolvedWorkspaceId),
          workspaceGrepTool(resolvedWorkspaceId),
          workspaceReadTool({
            workspaceId: resolvedWorkspaceId,
            visionCapable,
          }),
          workspaceEditTool({
            workspaceId: resolvedWorkspaceId,
            emitter: stream,
            interactiveSession: true,
            messageId: message.messageId,
          }),
          workspaceCreateFileTool({
            workspaceId: resolvedWorkspaceId,
            emitter: stream,
            interactiveSession: true,
            messageId: message.messageId,
          }),
        );
      } catch (err) {
        console.warn('Failed to build workspace context:', err);
      }
    }

    // Save user message to DB first, so the DB is authoritative before we read from it
    await handleHistorySave(
      message,
      humanMessageId,
      body.focusMode,
      body.files,
      body.messageImages,
      body.isPrivate,
      body.workspaceId,
    );

    // Resolve invoked skill set (UI hints + server-side /skill-name scan).
    // We need this both for persistence below and for the agent prompt later.
    const allSkillsForChat = await resolveSkillsForChat(resolvedWorkspaceId);
    const invokedSkillNames = new Set<string>(body.invokedSkills ?? []);
    for (const m of message.content.matchAll(SKILL_TOKEN_SCAN_REGEX)) {
      const name = m[1];
      if (getByName(allSkillsForChat, name)) {
        invokedSkillNames.add(name);
      }
    }

    // Persist invoked-skill bodies as system rows attached to this turn.
    // They ride along on subsequent turns via buildHistoryFromDb naturally,
    // so no in-flight SystemMessage injection is needed.
    for (const skillName of invokedSkillNames) {
      const skill = getByName(allSkillsForChat, skillName);
      if (!skill) continue;
      try {
        await persistToolContextRow({
          chatId: message.chatId,
          parentMessageId: humanMessageId,
          kind: 'skill_invocation',
          invoker: 'user',
          body: `[Skill "${skillName}" invoked by user]\n${skill.content}`,
          metadataExtras: { skillName },
        });
      } catch (err) {
        console.warn(
          `[skills] Failed to persist user-invoked skill "${skillName}":`,
          err,
        );
      }
    }

    // Read messages from DB (now includes the just-saved user message and
    // any system rows persisted just above).
    const dbMessages = await getChatMessages(message.chatId, {
      includeSystem: true,
    });

    // Exclude the current user message from history: it will be added directly
    // to the agent as the query/humanMsg parameter. Including it here as well
    // would cause it to appear twice in the LLM message list, which is
    // especially visible when compaction is active (the message ends up
    // after the summary AND again as the final human turn).
    const historyMessages = dbMessages.filter(
      (m) => m.messageId !== humanMessageId,
    );
    console.log(
      `[DEBUG][POST] historyMessages after excluding current user msg (${humanMessageId}): ${historyMessages.length} (was ${dbMessages.length})`,
    );

    // Apply compaction if the chat has been compacted — read the latest
    // checkpoint from the messages table (single source of truth).
    const compactionRows = await getCompactionRows(message.chatId);
    const lastCheckpoint = compactionRows[compactionRows.length - 1];
    const compactionSummary = lastCheckpoint?.content;
    const compactionMeta = lastCheckpoint
      ? (JSON.parse((lastCheckpoint.metadata as string) || '{}') as Record<
          string,
          unknown
        >)
      : {};
    const compactedUpTo = compactionMeta.compactedUpTo as number | undefined;

    let history: BaseMessage[];
    // compactedUpTo must be a number (the auto-increment id). Legacy
    // compactions stored a UUID messageId instead — skip those since a
    // UUID/number comparison always produces NaN and drops all messages.
    if (
      compactionSummary &&
      typeof compactedUpTo === 'number' &&
      compactedUpTo >= 0
    ) {
      // Prepend summary as a system message
      const summaryMsg = new SystemMessage(
        `[Previous conversation summary — compressed older messages. The verbatim messages that follow are more recent and more authoritative. Prefer them when they conflict.]:\n${compactionSummary}`,
      );
      // Only include messages after the compaction point (id is auto-increment)
      const compactedMessages = historyMessages.filter(
        (m) => m.id > compactedUpTo,
      );
      console.log(
        `[DEBUG][POST] Building history WITH compaction: compactedUpTo=${compactedUpTo}, totalDbMessages=${dbMessages.length}, historyMessages=${historyMessages.length}, keptMessages=${compactedMessages.length}, keptIds=[${compactedMessages.map((m) => m.id).join(',')}]`,
      );
      history = [summaryMsg, ...buildHistoryFromDb(compactedMessages)];
    } else {
      console.log(
        `[DEBUG][POST] Building history WITHOUT compaction: totalDbMessages=${dbMessages.length}, historyMessages=${historyMessages.length}, compactionSummary=${!!compactionSummary}, compactedUpTo=${compactedUpTo}`,
      );
      history = buildHistoryFromDb(historyMessages);
    }

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
      true,
      methodologyInstructions,
      body.isPrivate,
      distillationUsage,
      workspaceSuffix,
      resolvedWorkspaceId,
      aiMessageId,
    );

    // Tell the agent which skills the user explicitly invoked. The bodies
    // themselves were already persisted as system rows above and now live
    // in `history` via buildHistoryFromDb — no in-flight injection needed.
    handler.setInvokedSkillNames(invokedSkillNames);
    // Store model refs so the agent can build a config snapshot for resume.
    handler.setModelRefs(body.chatModel!, body.systemModel);

    // Build a stable thread_id for LangGraph checkpointing: messageId:startedAt
    // Using startedAt avoids collisions on regenerate/retry of the same user message.
    const runStartedAt = Date.now();
    const threadId = `${humanMessageId}:${runStartedAt}`;
    handler.setThreadId(threadId);

    // Register run in hub (idempotent — isNew=false if already live)
    const { run, isNew } = startRun({
      chatId: message.chatId,
      messageId: humanMessageId,
      aiMessageId,
      threadId,
      emitter: stream,
      abortController,
      retrievalController,
    });

    if (isNew) {
      try {
        // Wire event listeners + insert empty assistant row
        const configSnapshot = handler.buildConfigSnapshot(
          body.focusMode,
          body.files ?? [],
        );
        await attachRunHost({
          run,
          startTime,
          userMessageId: message.messageId,
          usedLocation: body.userLocation
            ? body.userLocation.length > 0
            : false,
          usedPersonalization: body.userProfile
            ? body.userProfile.length > 0
            : false,
          memoriesUsed,
          configSnapshot,
        });
      } catch (err) {
        // Clean up the dangling run entry before rethrowing
        evictByChatId(run.chatId);
        throw err;
      }

      // Fire agent (not awaited — runs independently until end/error)
      handler.searchAndAnswer(
        message.content,
        history,
        body.files,
        body.focusMode,
        undefined,
        undefined,
        body.messageImageIds,
        workspaceExtraTools.length > 0 ? workspaceExtraTools : undefined,
      );

      // Post-response automatic memory extraction (fire-and-forget)
      // If a workspace is active, only run if autoMemoryEnabled is explicitly ON (=1).
      const autoMemoryAllowed =
        body.memoryAutoDetection &&
        (!resolvedWorkspace || resolvedWorkspace.autoMemoryEnabled === 1);
      if (autoMemoryAllowed && systemLlm) {
        const capturedChatId = message.chatId;
        const capturedWorkspaceId = resolvedWorkspaceId;
        stream.on('end', () => {
          // Re-query the chat to get the authoritative workspaceId — handleHistorySave
          // runs fire-and-forget, so by stream end the row should exist.
          db.query.chats
            .findFirst({ where: eq(chats.id, capturedChatId) })
            .then((chat) => {
              const wsId = chat?.workspaceId ?? capturedWorkspaceId;
              return processExtraction(
                message.content,
                '', // assistant response text is captured in runHost
                systemLlm!,
                embedding,
                capturedChatId,
                wsId,
              );
            })
            .then((result) => {
              if (result.saved > 0 || result.updated > 0) {
                pushEvent(run, {
                  type: 'memory_updated',
                  data: {
                    saved: result.saved,
                    updated: result.updated,
                    memoryIds: result.memories.map((m) => m.id),
                  },
                });
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
    }

    // Subscribe to the run's event stream and pipe to the HTTP response
    const subStream = subscribe(run, 0, req.signal);
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
