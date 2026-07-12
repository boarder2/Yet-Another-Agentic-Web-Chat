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
import { createTurnTracker } from '@/lib/tokens/tracker';
import { onStreamEvent } from '@/lib/streaming/events';

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

    // 6. Insert chat row. Mark it in-progress with the same activeRunMessageId/
    // activeRunStartedAt markers interactive runs use so the scheduled-tasks
    // list can show "running" and the unread badge stays suppressed until the
    // run finishes (badge queries require activeRunMessageId IS NULL).
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
        activeRunMessageId: userMessageId,
        activeRunStartedAt: Date.now(),
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
    const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
      emitter,
      task.chatModel,
      task.systemModel,
    );
    const agent = new SimplifiedAgent(
      chatLlm,
      systemLlm,
      embedding,
      emitter,
      personaInstructionsContent,
      abortController.signal,
      { tracker, chatRecorder, systemRecorder },
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
      onStreamEvent(emitter, (event) => {
        if (event.type === 'response') {
          receivedMessage += event.data;
        } else if (event.type === 'sources' || event.type === 'sources_added') {
          sources = event.data as unknown as Array<Record<string, unknown>>;
          if (event.searchQuery) searchQuery = event.searchQuery;
          if (event.searchUrl) searchUrl = event.searchUrl;
        } else if (event.type === 'tool_call_started') {
          if (event.data.content) receivedMessage += event.data.content;
        } else if (event.type === 'tool_call_success') {
          receivedMessage = updateToolCallMarkup(
            receivedMessage,
            event.data.toolCallId,
            { status: event.data.status, extra: event.data.extra },
          );
        } else if (event.type === 'tool_call_error') {
          receivedMessage = updateToolCallMarkup(
            receivedMessage,
            event.data.toolCallId,
            { status: event.data.status, error: event.data.error },
          );
        } else if (event.type === 'model_stats') {
          modelStats = event.data as unknown as Record<string, unknown>;
        } else if (event.type === 'agent_end') {
          resolve();
        } else if (event.type === 'agent_error') {
          reject(new Error(event.data));
        }
      });

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

    // 12. Clear in-progress markers — the run is complete, so the chat is now
    // an unread finished run (scheduledRunViewed stays 0 until viewed).
    await db
      .update(chats)
      .set({ activeRunMessageId: null, activeRunStartedAt: null })
      .where(eq(chats.id, chatId))
      .execute();

    // 13. Update task
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

    // Insert synthetic error message
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

    // Clear in-progress markers so the run no longer shows as running and the
    // failed run can surface as unread. No-ops if the chat row was never
    // inserted (e.g. model resolution failed before step 6).
    try {
      await db
        .update(chats)
        .set({ activeRunMessageId: null, activeRunStartedAt: null })
        .where(eq(chats.id, chatId))
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
