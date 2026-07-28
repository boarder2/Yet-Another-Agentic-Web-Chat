/**
 * Headless runner for a schedule (one-shot report in run history).
 *
 * Known v1 limitations:
 * - Subagent events (subagent_started, subagent_data, etc.) are not collected.
 *   If a schedule triggers deep_research, the persisted message may have
 *   incomplete subagent markup.
 * - Code-execution and user-question events are ignored (headless, no human).
 * - Memory extraction is NOT run for scheduled runs to keep them deterministic.
 *
 * Config + prompt substitution are shared with the manual run path via
 * resolveWorkflowRun (§7.3); only this execution surface (headless persist vs
 * interactive stream) differs.
 */

import crypto from 'crypto';
import { EventEmitter } from 'stream';
import db from '@/lib/db';
import {
  chats,
  messages as messagesSchema,
  schedules,
  workflows,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { computeSanitizedContent } from '@/lib/db/sanitizedContent';
import { resolveChatAndEmbedding } from '@/lib/providers/resolveModels';
import {
  getPersonaInstructionsOnly,
  getMethodologyInstructions,
} from '@/lib/utils/prompts';
import {
  appendWidget,
  updateWidget,
  neutralizeSpoofedFences,
  type ToolCallPayload,
} from '@/lib/widgets/envelope';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';
import { createTurnTracker } from '@/lib/tokens/tracker';
import { onStreamEvent } from '@/lib/streaming/events';
import { resolveWorkflowRun } from '@/lib/workflows/resolveWorkflowRun';

export async function runSchedule(
  scheduleId: string,
): Promise<{ chatId: string; status: 'success' | 'error'; error?: string }> {
  const schedule = await db.query.schedules.findFirst({
    where: eq(schedules.id, scheduleId),
  });

  if (!schedule || !schedule.enabled) {
    return {
      chatId: '',
      status: 'error',
      error: 'Schedule not found or disabled',
    };
  }

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, schedule.workflowId),
  });
  if (!workflow) {
    return { chatId: '', status: 'error', error: 'Workflow not found' };
  }

  const chatId = crypto.randomUUID();
  const userMessageId = crypto.randomBytes(7).toString('hex');
  const aiMessageId = crypto.randomBytes(7).toString('hex');

  try {
    const run = resolveWorkflowRun(
      workflow,
      schedule.inputValues ?? {},
      new Date(),
    );

    const { chatLlm, systemLlm, embedding } = await resolveChatAndEmbedding({
      chatModel: run.chatModel,
      systemModel: run.systemModel,
    });

    const personaInstructionsContent = await getPersonaInstructionsOnly(
      run.selectedSystemPromptIds,
    );
    const methodologyInstructions = await getMethodologyInstructions(
      run.selectedMethodologyId,
    );

    const composedQuery = run.composedQuery;

    // Insert chat row. Mark it in-progress with the same activeRunMessageId/
    // activeRunStartedAt markers interactive runs use so the list can show
    // "running" and the unread badge stays suppressed until the run finishes.
    await db
      .insert(chats)
      .values({
        id: chatId,
        title: `${schedule.label} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        createdAt: Date.now(),
        focusMode: run.focusMode,
        files: [],
        isPrivate: 0,
        scheduleId: schedule.id,
        lastRunViewed: 0,
        activeRunMessageId: userMessageId,
        activeRunStartedAt: Date.now(),
      })
      .execute();

    await db
      .insert(messagesSchema)
      .values({
        content: composedQuery,
        sanitizedContent: computeSanitizedContent(composedQuery),
        chatId,
        messageId: userMessageId,
        role: 'user',
        metadata: JSON.stringify({ createdAt: new Date() }),
      })
      .execute();

    const abortController = new AbortController();
    const emitter = new EventEmitter();
    const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
      emitter,
      run.chatModel,
      run.systemModel,
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

    let receivedMessage = '';
    let sources: Array<Record<string, unknown>> = [];
    let searchQuery = '';
    let searchUrl = '';
    let modelStats: Record<string, unknown> | undefined;
    const startTime = Date.now();

    await new Promise<void>((resolve, reject) => {
      onStreamEvent(emitter, (event) => {
        if (event.type === 'response') {
          receivedMessage += neutralizeSpoofedFences(event.data);
        } else if (event.type === 'sources' || event.type === 'sources_added') {
          sources = event.data as unknown as Array<Record<string, unknown>>;
          if (event.searchQuery) searchQuery = event.searchQuery;
          if (event.searchUrl) searchUrl = event.searchUrl;
        } else if (event.type === 'tool_call_started') {
          receivedMessage = appendWidget<ToolCallPayload>(
            receivedMessage,
            'tool_call',
            {
              id: event.data.toolCallId,
              type: event.data.toolType,
              status: event.data.status,
              ...event.data.attrs,
            },
          );
        } else if (event.type === 'tool_call_success') {
          receivedMessage = updateWidget<ToolCallPayload>(
            receivedMessage,
            'tool_call',
            event.data.toolCallId,
            { status: event.data.status, ...event.data.extra },
          );
        } else if (event.type === 'tool_call_error') {
          receivedMessage = updateWidget<ToolCallPayload>(
            receivedMessage,
            'tool_call',
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

      agent.searchAndAnswer(
        composedQuery,
        [],
        [],
        run.focusMode,
        undefined,
        undefined,
        undefined,
      );
    });

    if (modelStats) {
      modelStats = { ...modelStats, responseTime: Date.now() - startTime };
    }

    await db
      .insert(messagesSchema)
      .values({
        content: receivedMessage,
        sanitizedContent: computeSanitizedContent(receivedMessage),
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

    // Mirror runHost's terminate: stamp the chat-level run state so the run
    // shows up as an ordinary unread run in History (headless, so never viewed).
    await db
      .update(chats)
      .set({
        activeRunMessageId: null,
        activeRunStartedAt: null,
        lastRunStatus: 'completed',
        lastRunViewed: 0,
      })
      .where(eq(chats.id, chatId))
      .execute();

    await db
      .update(schedules)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: 'success',
        lastRunError: null,
        lastRunChatId: chatId,
        updatedAt: new Date(),
      })
      .where(eq(schedules.id, scheduleId))
      .execute();

    return { chatId, status: 'success' };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : 'Unknown error during scheduled run';

    try {
      await db
        .insert(messagesSchema)
        .values({
          content: `**Scheduled run failed:** ${errorMsg}`,
          sanitizedContent: computeSanitizedContent(
            `**Scheduled run failed:** ${errorMsg}`,
          ),
          chatId,
          messageId: aiMessageId,
          role: 'assistant',
          metadata: JSON.stringify({ createdAt: new Date() }),
        })
        .execute();
    } catch {
      // Best-effort
    }

    try {
      await db
        .update(chats)
        .set({
          activeRunMessageId: null,
          activeRunStartedAt: null,
          lastRunStatus: 'errored',
          lastRunViewed: 0,
        })
        .where(eq(chats.id, chatId))
        .execute();
    } catch {
      // Best-effort
    }

    try {
      await db
        .update(schedules)
        .set({
          lastRunAt: new Date(),
          lastRunStatus: 'error',
          lastRunError: errorMsg,
          lastRunChatId: chatId,
          updatedAt: new Date(),
        })
        .where(eq(schedules.id, scheduleId))
        .execute();
    } catch {
      // Best-effort
    }

    return { chatId, status: 'error', error: errorMsg };
  }
}
