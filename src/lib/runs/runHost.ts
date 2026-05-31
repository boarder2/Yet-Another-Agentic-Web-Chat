import { updateToolCallMarkup } from '@/lib/utils/toolCallMarkup';
import { encodeHtmlAttribute } from '@/lib/utils/html';
import {
  insertPartialAssistantRow,
  updateAssistantRow,
  sumMessageContentChars,
} from '@/lib/db/queries';
import { pushEvent, terminateRun, type Run } from './runHub';
import { denyApprovalsForMessage } from '@/lib/sandbox/pendingApprovals';
import { cancelQuestionsForMessage } from '@/lib/userQuestion/pendingQuestions';
import { cancelEditsForMessage } from '@/lib/workspaces/pendingEdits';
import { cancelEditsForMessage as cancelSkillEditsForMessage } from '@/lib/skills/pendingEdits';
import { cleanupCancelToken } from '@/lib/cancel-tokens';
import { cleanupRun } from '@/lib/utils/runControl';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

type ModelStats = {
  modelName: string;
  responseTime?: number;
  usage?: TokenUsage;
  modelNameChat?: string;
  modelNameSystem?: string;
  usageChat?: TokenUsage;
  usageSystem?: TokenUsage;
  usedLocation?: boolean;
  usedPersonalization?: boolean;
  firstChatCallInputTokens?: number;
};

/**
 * Wire up event listeners for the run's EventEmitter.
 * Inserts an empty assistant row immediately, accumulates message content,
 * flushes to the DB incrementally, and finalises on end/error/cancel.
 */
export async function attachRunHost(params: {
  run: Run;
  startTime: number;
  userMessageId: string;
  usedLocation: boolean;
  usedPersonalization: boolean;
  memoriesUsed: Array<{ id: string; content: string }>;
}): Promise<void> {
  const {
    run,
    startTime,
    userMessageId,
    usedLocation,
    usedPersonalization,
    memoriesUsed,
  } = params;
  const { emitter, aiMessageId, chatId } = run;

  // Insert empty assistant row immediately so a refresh can see partial state
  await insertPartialAssistantRow(aiMessageId, chatId, {
    createdAt: new Date(),
    runStatus: 'running',
  });

  // Write chat markers so a freshly-mounted ChatWindow knows a run is live.
  // Reset lastRunViewed to 0: a new run produces a result the user has not yet
  // seen, so the thread is unread until either it completes while subscribed
  // (terminate sets it back to 1) or it is opened after finishing. Without this
  // a stale 1 from opening the chat before submitting would survive the
  // COALESCE in terminate and suppress the unread badge.
  await db
    .update(chats)
    .set({
      activeRunMessageId: run.messageId,
      activeRunStartedAt: run.startedAt,
      lastRunViewed: 0,
    })
    .where(eq(chats.id, chatId))
    .execute();

  let recievedMessage = '';
  const codeExecutionRunIdMap = new Map<string, string>();
  const userQuestionRunIdMap = new Map<string, string>();
  const chartSpecs: Record<string, unknown> = {};
  let sources: Record<string, unknown>[] = [];
  let searchQuery: string | undefined;
  let searchUrl: string | undefined;
  let modelStats: ModelStats = { modelName: '' };
  let terminated = false;

  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleFlush = (immediate: boolean) => {
    if (immediate) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      doFlush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        doFlush();
      }, 250);
    }
  };

  const doFlush = () => {
    updateAssistantRow(aiMessageId, {
      content: recievedMessage,
      metadata: {
        createdAt: new Date(),
        runStatus: 'running',
        ...(sources.length > 0 && { sources }),
        ...(searchQuery && { searchQuery }),
        ...(searchUrl && { searchUrl }),
        ...(Object.keys(chartSpecs).length > 0 && { chartSpecs }),
      },
    }).catch((err: unknown) =>
      console.warn('[runHost] incremental flush failed:', err),
    );
  };

  const terminate = async (
    status: 'completed' | 'errored' | 'cancelled',
    finalMetadata: Record<string, unknown>,
  ) => {
    if (terminated) return;
    terminated = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      await updateAssistantRow(aiMessageId, {
        content: recievedMessage,
        metadata: finalMetadata,
      });
    } catch (err) {
      console.warn('[runHost] terminal flush failed:', err);
    }
    // Capture subscriber count before terminateRun clears them.
    const hadSubscriber = run.subscribers.size > 0;
    terminateRun(run, status);
    cleanupCancelToken(userMessageId);
    cleanupRun(userMessageId);
    // Clear chat markers and record terminal state.
    // Use COALESCE for lastRunViewed so a concurrent markSeen(=1) write is
    // not overwritten; only defaults to 0 when the column is still NULL.
    db.update(chats)
      .set({
        activeRunMessageId: null,
        activeRunStartedAt: null,
        lastRunStatus: status,
        lastRunViewed: hadSubscriber ? 1 : sql`COALESCE(last_run_viewed, 0)`,
      })
      .where(eq(chats.id, chatId))
      .execute()
      .catch((err: unknown) =>
        console.warn('[runHost] chat marker clear failed:', err),
      );
  };

  // Cancel path: abortController fired by cancelRequest()
  run.abortController.signal.addEventListener('abort', () => {
    if (terminated) return;
    // Also abort retrieval to stop agent processing
    if (!run.retrievalController.signal.aborted) {
      run.retrievalController.abort();
    }
    denyApprovalsForMessage(userMessageId);
    cancelQuestionsForMessage(userMessageId);
    cancelEditsForMessage(userMessageId);
    cancelSkillEditsForMessage(userMessageId);

    pushEvent(run, {
      type: 'error',
      data: 'Request cancelled by user',
    });

    terminate('cancelled', {
      createdAt: new Date(),
      runStatus: 'cancelled',
      ...(sources.length > 0 && { sources }),
      ...(searchQuery && { searchQuery }),
      ...(searchUrl && { searchUrl }),
      ...(Object.keys(chartSpecs).length > 0 && { chartSpecs }),
    }).catch(console.warn);
  });

  emitter.on('data', (data: string) => {
    if (terminated) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedData = JSON.parse(data) as Record<string, any>;

    if (parsedData.type === 'response') {
      pushEvent(run, {
        type: 'response',
        data: parsedData.data,
        messageId: aiMessageId,
      });
      recievedMessage += parsedData.data;
      scheduleFlush(false);
    } else if (
      parsedData.type === 'sources' ||
      parsedData.type === 'sources_added'
    ) {
      if (parsedData.searchQuery) searchQuery = parsedData.searchQuery;
      if (parsedData.searchUrl) searchUrl = parsedData.searchUrl;

      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        searchQuery: parsedData.searchQuery,
        messageId: aiMessageId,
        searchUrl,
      });

      sources = parsedData.data;
      scheduleFlush(true);
    } else if (
      parsedData.type === 'tool_call_started' ||
      parsedData.type === 'tool_call_success' ||
      parsedData.type === 'tool_call_error'
    ) {
      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        messageId: aiMessageId,
      });

      if (parsedData.type === 'tool_call_started' && parsedData.data?.content) {
        recievedMessage += parsedData.data.content;
      } else if (
        parsedData.type === 'tool_call_success' ||
        parsedData.type === 'tool_call_error'
      ) {
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
      scheduleFlush(true);
    } else if (
      parsedData.type === 'subagent_started' ||
      parsedData.type === 'subagent_completed' ||
      parsedData.type === 'subagent_error' ||
      parsedData.type === 'subagent_data'
    ) {
      pushEvent(run, { ...parsedData, messageId: aiMessageId });

      if (parsedData.type === 'subagent_started') {
        const markup = `<SubagentExecution id="${parsedData.executionId}" name="${encodeHtmlAttribute(parsedData.name ?? '')}" task="${encodeHtmlAttribute(parsedData.task ?? '')}" status="running"></SubagentExecution>\n`;
        recievedMessage += markup;
      } else if (parsedData.type === 'subagent_data') {
        const nestedEvent = parsedData.data;
        const executionId = parsedData.subagentId;
        if (
          nestedEvent?.type === 'tool_call_started' &&
          nestedEvent.data?.content
        ) {
          const subagentRegex = new RegExp(
            `(<SubagentExecution\\s+id="${executionId}"[^>]*>)(.*?)(</SubagentExecution>)`,
            'gs',
          );
          recievedMessage = recievedMessage.replace(
            subagentRegex,
            (_match, openTag, content, closeTag) =>
              `${openTag}${content}${nestedEvent.data.content}\n${closeTag}`,
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
            { status: 'error', error: nestedEvent.data.error },
          );
        }
      } else if (
        parsedData.type === 'subagent_completed' ||
        parsedData.type === 'subagent_error'
      ) {
        const status =
          parsedData.type === 'subagent_completed' ? 'success' : 'error';
        const executionId = parsedData.id;
        const subagentRegex = new RegExp(
          `<SubagentExecution\\s+id="${executionId}"([^>]*)>(.*?)<\\/SubagentExecution>`,
          'gs',
        );
        recievedMessage = recievedMessage.replace(
          subagentRegex,
          (_match, attrs, innerContent) => {
            let updatedAttrs = attrs
              .replace(/status="[^"]*"/, `status="${status}"`)
              .trim();
            if (!updatedAttrs.includes('status='))
              updatedAttrs += ` status="${status}"`;
            if (parsedData.summary && status === 'success') {
              const esc = parsedData.summary
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
              updatedAttrs += ` summary="${esc}"`;
            }
            if (parsedData.error && status === 'error') {
              const esc = parsedData.error
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
              updatedAttrs += ` error="${esc}"`;
            }
            return `<SubagentExecution ${updatedAttrs}>${innerContent}</SubagentExecution>`;
          },
        );
      }
      scheduleFlush(true);
    } else if (parsedData.type === 'chart_spec') {
      const { chartId, spec } = parsedData.data ?? {};
      if (chartId && spec) chartSpecs[chartId] = spec;
      pushEvent(run, {
        type: 'chart_spec',
        data: parsedData.data,
        messageId: aiMessageId,
      });
      scheduleFlush(true);
    } else if (parsedData.type === 'todo_update') {
      pushEvent(run, {
        type: 'todo_update',
        data: parsedData.data,
        messageId: aiMessageId,
      });
    } else if (parsedData.type === 'code_execution_pending') {
      const runId = parsedData.data?.markupToolCallId;
      if (runId && parsedData.data?.executionId) {
        codeExecutionRunIdMap.set(parsedData.data.executionId, runId);
      }
      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        messageId: aiMessageId,
      });
    } else if (parsedData.type === 'code_execution_result') {
      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        messageId: aiMessageId,
      });
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
        if (Array.isArray(d.chartIds) && d.chartIds.length > 0)
          extra.chartIds = d.chartIds.join(',');
        recievedMessage = updateToolCallMarkup(recievedMessage, tcId, {
          extra,
        });
      }
      scheduleFlush(true);
    } else if (parsedData.type === 'user_question_pending') {
      const runId = parsedData.data?.markupToolCallId;
      if (runId && parsedData.data?.questionId) {
        userQuestionRunIdMap.set(parsedData.data.questionId, runId);
      }
      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        messageId: aiMessageId,
      });
    } else if (parsedData.type === 'user_question_answered') {
      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        messageId: aiMessageId,
      });
      const tcId =
        userQuestionRunIdMap.get(parsedData.data?.questionId) ||
        parsedData.data?.toolCallId;
      if (tcId) {
        const d = parsedData.data;
        const extra: Record<string, string> = {};
        if (d.selectedOptions?.length)
          extra.selectedOptions = d.selectedOptions.join(', ');
        if (d.freeformText) extra.freeformText = d.freeformText.slice(0, 500);
        if (d.skipped) extra.skipped = 'true';
        if (d.timedOut) extra.timedOut = 'true';
        recievedMessage = updateToolCallMarkup(recievedMessage, tcId, {
          extra,
        });
      }
      scheduleFlush(true);
    } else if (
      parsedData.type === 'workspace_edit_approval_pending' ||
      parsedData.type === 'workspace_edit_approval_answered' ||
      parsedData.type === 'skill_edit_approval_pending' ||
      parsedData.type === 'skill_edit_approval_answered'
    ) {
      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        messageId: aiMessageId,
      });
    } else if (parsedData.type === 'context_grew') {
      pushEvent(run, {
        type: 'context_grew',
        kind: parsedData.kind,
        tokens: parsedData.tokens,
        totalEstimated: parsedData.totalEstimated,
        messageId: aiMessageId,
      });
    } else if (parsedData.type === 'workspace_file_changed') {
      pushEvent(run, {
        type: parsedData.type,
        data: parsedData.data,
        messageId: aiMessageId,
      });
    }
  });

  emitter.on('progress', (data: string) => {
    if (terminated) return;
    const parsedData = JSON.parse(data) as Record<string, unknown>;
    if (parsedData.type === 'progress') {
      pushEvent(run, {
        type: 'progress',
        data: parsedData.data,
        messageId: aiMessageId,
      });
    }
  });

  emitter.on('stats', (data: string) => {
    if (terminated) return;
    const parsedData = JSON.parse(data) as Record<string, unknown>;
    if (parsedData.type === 'modelStats') {
      modelStats = {
        ...(parsedData.data as ModelStats),
        usedLocation,
        usedPersonalization,
      };
      pushEvent(run, {
        type: 'stats',
        data: modelStats,
        messageId: aiMessageId,
      });
    }
  });

  emitter.on('end', async () => {
    if (terminated) return;

    const endTime = Date.now();
    modelStats = {
      ...modelStats,
      responseTime: endTime - startTime,
      usedLocation,
      usedPersonalization,
    };

    // Best-effort projection of next-turn input tokens (mirrors route.ts logic)
    let projectedNextInputTokens: number | undefined;
    try {
      const assistantEstimate = Math.round(recievedMessage.length / 4);
      if (modelStats.firstChatCallInputTokens) {
        // Accurate path: base = actual measured input for this turn. Only the
        // system rows appended after the user message during this turn are new
        // relative to that base, so sum just those (in SQL) rather than
        // re-reading the whole conversation.
        const newRowsChars = await sumMessageContentChars(chatId, {
          afterMessageId: userMessageId,
        });
        const newRowsTokens = Math.round(newRowsChars / 4);
        projectedNextInputTokens =
          modelStats.firstChatCallInputTokens +
          newRowsTokens +
          assistantEstimate;
      } else {
        // Fallback: estimate from all rows + fixed system-prompt estimate
        const fromRowsChars = await sumMessageContentChars(chatId);
        const SYSTEM_PROMPT_ESTIMATE = 3000;
        const fromRows = Math.round(fromRowsChars / 4);
        projectedNextInputTokens =
          fromRows + assistantEstimate + SYSTEM_PROMPT_ESTIMATE;
      }
    } catch (err) {
      console.warn('[runHost] projection failed:', err);
    }

    pushEvent(run, {
      type: 'messageEnd',
      messageId: aiMessageId,
      modelStats,
      searchQuery,
      searchUrl,
      usedLocation,
      usedPersonalization,
      memoriesUsed: memoriesUsed.length > 0 ? memoriesUsed : undefined,
      projectedNextInputTokens,
    });

    await terminate('completed', {
      createdAt: new Date(),
      ...(sources.length > 0 && { sources }),
      ...(searchQuery && { searchQuery }),
      modelStats,
      ...(searchUrl && { searchUrl }),
      usedLocation,
      usedPersonalization,
      ...(memoriesUsed.length > 0 && { memoriesUsed }),
      ...(Object.keys(chartSpecs).length > 0 && { chartSpecs }),
      // no runStatus field = success
    });
  });

  emitter.on('error', (data: string) => {
    if (terminated) return;
    const parsedData = JSON.parse(data) as Record<string, unknown>;
    pushEvent(run, { type: 'error', data: parsedData.data });

    terminate('errored', {
      createdAt: new Date(),
      runStatus: 'errored',
      ...(sources.length > 0 && { sources }),
      ...(searchQuery && { searchQuery }),
      ...(searchUrl && { searchUrl }),
      ...(Object.keys(chartSpecs).length > 0 && { chartSpecs }),
    }).catch(console.warn);
  });
}
