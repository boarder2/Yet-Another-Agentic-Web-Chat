/**
 * Headless runner for scheduled tasks.
 *
 * Known v1 limitations:
 * - Subagent events (subagent_started, subagent_data, etc.) are not collected.
 *   If a scheduled task triggers deep_research, the persisted message may have
 *   incomplete subagent markup.
 * - Code-execution and user-question events are ignored (headless, no human).
 * - Memory extraction is NOT run for scheduled tasks to keep runs deterministic.
 */

import crypto from 'crypto';
import { EventEmitter } from 'stream';
import db from '@/lib/db';
import {
  chats,
  messages as messagesSchema,
  scheduledTasks,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveChatAndEmbedding } from '@/lib/providers/resolveModels';
import {
  getPersonaInstructionsOnly,
  getMethodologyInstructions,
} from '@/lib/utils/prompts';
import { updateToolCallMarkup } from '@/lib/utils/toolCallMarkup';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';

export async function runScheduledTask(
  taskId: string,
): Promise<{ chatId: string; status: 'success' | 'error'; error?: string }> {
  // 1. Load task
  const task = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, taskId),
  });

  if (!task || !task.enabled) {
    return { chatId: '', status: 'error', error: 'Task not found or disabled' };
  }

  const chatId = crypto.randomUUID();
  const userMessageId = crypto.randomBytes(7).toString('hex');
  const aiMessageId = crypto.randomBytes(7).toString('hex');

  try {
    // 2. Resolve models
    const { chatLlm, systemLlm, embedding } = await resolveChatAndEmbedding({
      chatModel: task.chatModel,
      systemModel: task.systemModel,
      embeddingModel: task.embeddingModel,
    });

    // 3. Resolve persona + methodology
    const personaInstructionsContent = await getPersonaInstructionsOnly(
      task.selectedSystemPromptIds ?? [],
    );
    const methodologyInstructions = await getMethodologyInstructions(
      task.selectedMethodologyId ?? null,
    );

    // 5. Compose query
    let composedQuery = task.prompt;
    const sourceUrls = task.sourceUrls ?? [];
    if (sourceUrls.length > 0) {
      composedQuery +=
        '\n\nPrioritize these sources:\n' +
        sourceUrls.map((u: string) => `- ${u}`).join('\n');
    }

    // 6. Insert chat row
    await db
      .insert(chats)
      .values({
        id: chatId,
        title: `${task.name} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        createdAt: Date.now(),
        focusMode: task.focusMode,
        files: [],
        isPrivate: 0,
        scheduledTaskId: task.id,
        scheduledRunViewed: 0,
      })
      .execute();

    // 7. Insert user message
    await db
      .insert(messagesSchema)
      .values({
        content: composedQuery,
        chatId,
        messageId: userMessageId,
        role: 'user',
        metadata: JSON.stringify({ createdAt: new Date() }),
      })
      .execute();

    // 8. Create agent
    const abortController = new AbortController();
    const emitter = new EventEmitter();
    const agent = new SimplifiedAgent(
      chatLlm,
      systemLlm,
      embedding,
      emitter,
      personaInstructionsContent,
      abortController.signal,
      userMessageId,
      abortController.signal,
      undefined, // userLocation
      undefined, // userProfile
      false, // memoryEnabled
      '', // memorySection
      chatId,
      false, // interactiveSession
      methodologyInstructions,
    );

    // 9. Collect events
    let receivedMessage = '';
    let sources: Array<Record<string, unknown>> = [];
    let searchQuery = '';
    let searchUrl = '';
    let modelStats: Record<string, unknown> | undefined;
    const startTime = Date.now();

    await new Promise<void>((resolve, reject) => {
      emitter.on('data', (data: string) => {
        try {
          const parsedData = JSON.parse(data);
          if (parsedData.type === 'response') {
            receivedMessage += parsedData.data;
          } else if (
            parsedData.type === 'sources' ||
            parsedData.type === 'sources_added'
          ) {
            sources = parsedData.data;
            if (parsedData.searchQuery) searchQuery = parsedData.searchQuery;
            if (parsedData.searchUrl) searchUrl = parsedData.searchUrl;
          } else if (
            parsedData.type === 'tool_call_started' &&
            parsedData.data?.content
          ) {
            receivedMessage += parsedData.data.content;
          } else if (
            parsedData.type === 'tool_call_success' ||
            parsedData.type === 'tool_call_error'
          ) {
            receivedMessage = updateToolCallMarkup(
              receivedMessage,
              parsedData.data.toolCallId,
              {
                status: parsedData.data.status,
                error: parsedData.data.error,
                extra: parsedData.data.extra,
              },
            );
          }
        } catch {
          // Ignore unparseable events
        }
      });

      emitter.on('stats', (data: string) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'modelStats') {
            modelStats = parsed.data;
          }
        } catch {
          // Ignore
        }
      });

      emitter.on('end', () => resolve());
      emitter.on('error', (e: unknown) => reject(new Error(String(e))));

      // 10. Start agent (do NOT await — lifecycle managed by emitter)
      agent.searchAndAnswer(
        composedQuery,
        [],
        [],
        task.focusMode,
        undefined,
        undefined,
        undefined,
      );
    });

    if (modelStats) {
      modelStats = { ...modelStats, responseTime: Date.now() - startTime };
    }

    // 11. Insert assistant message
    await db
      .insert(messagesSchema)
      .values({
        content: receivedMessage,
        chatId,
        messageId: aiMessageId,
        role: 'assistant',
        metadata: JSON.stringify({
          createdAt: new Date(),
          ...(sources.length > 0 && { sources }),
          ...(searchQuery && { searchQuery }),
          ...(searchUrl && { searchUrl }),
          ...(modelStats && { modelStats }),
        }),
      })
      .execute();

    // 12. Update task
    await db
      .update(scheduledTasks)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: 'success',
        lastRunError: null,
        lastRunChatId: chatId,
        updatedAt: new Date(),
      })
      .where(eq(scheduledTasks.id, taskId))
      .execute();

    return { chatId, status: 'success' };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : 'Unknown error during task run';

    // 13. Insert synthetic error message
    try {
      await db
        .insert(messagesSchema)
        .values({
          content: `**Scheduled task failed:** ${errorMsg}`,
          chatId,
          messageId: aiMessageId,
          role: 'assistant',
          metadata: JSON.stringify({ createdAt: new Date() }),
        })
        .execute();
    } catch {
      // Best-effort
    }

    // Update task with error
    try {
      await db
        .update(scheduledTasks)
        .set({
          lastRunAt: new Date(),
          lastRunStatus: 'error',
          lastRunError: errorMsg,
          lastRunChatId: chatId,
          updatedAt: new Date(),
        })
        .where(eq(scheduledTasks.id, taskId))
        .execute();
    } catch {
      // Best-effort
    }

    return { chatId, status: 'error', error: errorMsg };
  }
}
