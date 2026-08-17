/**
 * Manual workflow run — seeds a normal, continuable chat (§7.1).
 *
 * Shares config + prompt substitution with the scheduled path via
 * resolveWorkflowRun; the difference is the execution surface: the run is
 * registered in the run hub (startRun + attachRunHost) exactly like an
 * interactive `/api/chat` turn, so a client that navigates to the returned chat
 * attaches to the live stream and can continue the conversation afterwards.
 *
 * Deliberately scoped like the headless runner (no workspace/MCP tools, no
 * memory, no panel) — a workflow run reproduces the workflow's stored config
 * (Decision 14), not the caller's ambient session.
 */

import crypto from 'crypto';
import { EventEmitter } from 'stream';
import db from '@/lib/db';
import { chats, messages as messagesSchema } from '@/lib/db/schema';
import { computeSanitizedContent } from '@/lib/db/sanitizedContent';
import { resolveChatAndEmbedding } from '@/lib/providers/resolveModels';
import {
  getPersonaInstructionsOnly,
  getMethodologyInstructions,
} from '@/lib/utils/prompts';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';
import { createTurnTracker } from '@/lib/tokens/tracker';
import { getSettings, getBooleanSetting } from '@/lib/settings/server';
import { startRun, evictByChatId } from '@/lib/runs/runHub';
import { attachRunHost } from '@/lib/runs/runHost';
import {
  resolveWorkflowRun,
  type Workflow,
} from '@/lib/workflows/resolveWorkflowRun';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';

/**
 * Start a manual run of `workflow` with `values`, returning the seeded chat id.
 * Throws `RequiredInputsError` (via resolveWorkflowRun) if a required input is
 * missing — callers surface that as a structured error before any chat exists.
 */
export async function startWorkflowRun(
  workflow: Workflow,
  values: Record<string, string | string[]>,
): Promise<{ chatId: string }> {
  const run = resolveWorkflowRun(workflow, values, new Date());

  const { chatLlm, systemLlm, embedding } = await resolveChatAndEmbedding({
    chatModel: run.chatModel,
    systemModel: run.systemModel,
  });

  const personaInstructions = await getPersonaInstructionsOnly(
    run.selectedSystemPromptIds,
  );
  const methodologyInstructions = await getMethodologyInstructions(
    run.selectedMethodologyId,
  );

  const chatId = crypto.randomUUID();
  const userMessageId = crypto.randomBytes(7).toString('hex');
  const aiMessageId = crypto.randomBytes(7).toString('hex');
  const startTime = Date.now();

  // Seed the chat + verbatim first user message. workflow_id stamps provenance;
  // schedule_id stays null so this manual chat is excluded from scheduled
  // run-history queries (Decision, §4.3).
  await db
    .insert(chats)
    .values({
      id: chatId,
      title: workflow.name,
      createdAt: Date.now(),
      focusMode: run.focusMode,
      files: [],
      isPrivate: 0,
      workflowId: workflow.id,
    })
    .execute();

  await db
    .insert(messagesSchema)
    .values({
      content: run.composedQuery,
      sanitizedContent: computeSanitizedContent(run.composedQuery),
      chatId,
      messageId: userMessageId,
      role: 'user',
      metadata: JSON.stringify({ createdAt: new Date() }),
    })
    .execute();

  const emitter = new EventEmitter();
  const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
    emitter,
    run.chatModel,
    run.systemModel,
  );
  const chartRegistry = new TurnChartRegistry();

  const abortController = new AbortController();
  const retrievalController = new AbortController();

  const agent = new SimplifiedAgent(
    chatLlm,
    systemLlm,
    embedding,
    emitter,
    personaInstructions,
    abortController.signal,
    { tracker, chatRecorder, systemRecorder },
    userMessageId,
    retrievalController.signal,
    undefined, // userLocation
    undefined, // userProfile
    false, // memoryEnabled
    '', // memorySection
    chatId,
    true, // interactiveSession — continuable
    methodologyInstructions,
    false, // isPrivate
    '', // workspaceSuffix
    null, // workspaceId
    aiMessageId,
    chartRegistry,
  );
  agent.setModelRefs(run.chatModel, run.systemModel);

  const threadId = `${userMessageId}:${startTime}`;
  agent.setThreadId(threadId);

  const { run: hubRun, isNew } = startRun({
    chatId,
    messageId: userMessageId,
    aiMessageId,
    threadId,
    emitter,
    abortController,
    retrievalController,
    chartRegistry,
  });

  if (isNew) {
    const autoTitleEnabled = getBooleanSetting(
      getSettings(['autoTitleEnabled']),
      'autoTitleEnabled',
      true,
    );
    try {
      await attachRunHost({
        run: hubRun,
        startTime,
        userMessageId,
        usedLocation: false,
        usedPersonalization: false,
        memoriesUsed: [],
        configSnapshot: agent.buildConfigSnapshot(run.focusMode, []),
        titleGen: {
          systemLlm,
          systemRecorder,
          tracker,
          autoTitleEnabled,
        },
      });
    } catch (err) {
      evictByChatId(chatId);
      throw err;
    }

    // Fire the agent (not awaited — runs independently until end/error).
    agent.searchAndAnswer(
      run.composedQuery,
      [],
      [],
      run.focusMode,
      undefined,
      undefined,
      undefined,
    );
  }

  return { chatId };
}
