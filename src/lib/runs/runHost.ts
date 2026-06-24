import { updateToolCallMarkup } from '@/lib/utils/toolCallMarkup';
import {
  applyPanelExecutorStarted,
  applyPanelExecutorResponseToken,
  applyPanelExecutorStatus,
  panelExecutorTokens,
} from '@/lib/utils/panelMarkup';
import { encodeHtmlAttribute } from '@/lib/utils/html';
import {
  insertPartialAssistantRow,
  updateAssistantRow,
  sumMessageContentChars,
} from '@/lib/db/queries';
import {
  pushEvent,
  pauseRun,
  terminateRun,
  setRunStatus,
  registerReconstructedRun,
  setEventPersister,
  type Run,
  type RunStatus,
} from './runHub';
import {
  enqueueRunEvent,
  flushRunEvents,
  dropRunEventBuffer,
} from './runEventsPersistence';
import { deleteCheckpoint } from './checkpointer';
import { cleanupCancelToken, registerCancelToken } from '@/lib/cancel-tokens';
import {
  cleanupRun,
  registerRetrieval,
  clearSoftStop,
} from '@/lib/utils/runControl';
import db from '@/lib/db';
import {
  chats,
  approvalRequests,
  runEvents,
  messages as messagesSchema,
} from '@/lib/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';
import { popCallbackRunId } from '@/lib/sandbox/codeExecutionCorrelation';
import { popCallbackRunId as popQuestionCallbackRunId } from '@/lib/userQuestion/questionCorrelation';

// ── Types ──────────────────────────────────────────────────────────────────

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

type ToolKind =
  | 'ask_user'
  | 'code_execution'
  | 'workspace_edit'
  | 'workspace_create'
  | 'skill_edit';

interface InterruptValue {
  kind: ToolKind;
  toolCallId: string;
  markupKey?: string | null;
  payload: Record<string, unknown>;
  snapshot?: Record<string, unknown> | null;
}

interface LangGraphInterrupt {
  id: string;
  value: InterruptValue;
}

// In-memory lock to prevent concurrent resumes for the same approvalId
const resumeLocks = new Set<string>();

// Persist milestone events for cross-restart reconstruction. Registered once.
setEventPersister((run, seqEvent) => {
  enqueueRunEvent(run.messageId, run.chatId, seqEvent);
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Rewrite any still-"running" tool/subagent widgets in persisted markup to a
 * terminal state. On cancel the run is over, so nothing should keep spinning;
 * without this a cancelled chat renders frozen spinners for the in-flight tool.
 */
function scrubRunningToolMarkup(content: string): string {
  return content.replace(/status="running"/g, 'status="error"');
}

/** Pop the markup correlation ID for a given tool kind + key. */
function resolveMarkupToolCallId(
  kind: ToolKind,
  markupKey?: string | null,
): string | undefined {
  if (!markupKey) return undefined;
  if (kind === 'code_execution')
    return popCallbackRunId(markupKey) ?? undefined;
  return popQuestionCallbackRunId(markupKey) ?? undefined;
}

type ApprovalResolution = NonNullable<
  (typeof approvalRequests.$inferSelect)['resolutionKind']
>;

/** Mark all open (unresolved) approvals for a message with the given resolution. */
async function markOpenApprovals(
  messageId: string,
  resolutionKind: ApprovalResolution,
): Promise<void> {
  await db
    .update(approvalRequests)
    .set({ resolvedAt: Date.now(), resolutionKind })
    .where(
      and(
        eq(approvalRequests.messageId, messageId),
        isNull(approvalRequests.resolvedAt),
      ),
    )
    .execute();
}

/** Mark all open approvals for a message as interrupted (server restart). */
export function markOpenApprovalsInterrupted(messageId: string): Promise<void> {
  return markOpenApprovals(messageId, 'interrupted');
}

/** Mark all open approvals for a message as cancelled. */
export function markOpenApprovalsCancelled(messageId: string): Promise<void> {
  return markOpenApprovals(messageId, 'cancelled');
}

/** Get pending (unresolved) approvals for a message. */
export async function getPendingApprovalsForMessage(
  messageId: string,
): Promise<(typeof approvalRequests.$inferSelect)[]> {
  return db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.messageId, messageId),
        isNull(approvalRequests.resolvedAt),
      ),
    );
}

// ── handleInterrupts ────────────────────────────────────────────────────────

async function handleInterrupts(
  run: Run,
  interrupts: LangGraphInterrupt[],
): Promise<void> {
  for (const i of interrupts) {
    const { kind, toolCallId, markupKey, payload, snapshot } = i.value;

    const insert = await db
      .insert(approvalRequests)
      .values({
        id: i.id,
        chatId: run.chatId,
        messageId: run.messageId,
        threadId: run.threadId,
        toolCallId,
        engineInterruptId: i.id,
        toolKind: kind,
        payload,
        snapshot: snapshot ?? null,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .execute();

    // Already seen (e.g. re-detected after a partial parallel resume): the
    // *_pending event was emitted on first observation, so don't duplicate it.
    if ((insert as unknown as { changes?: number })?.changes === 0) continue;

    const markupToolCallId = resolveMarkupToolCallId(kind, markupKey);

    const ev: Record<string, unknown> = {
      type: `${kind}_pending`,
      data: { approvalId: i.id, toolCallId, markupToolCallId, ...payload },
      messageId: run.aiMessageId,
    };
    // pushEvent enqueues the *_pending event via the registered persister.
    pushEvent(run, ev);
  }

  pauseRun(run);
  // Force-flush so a fast reconnect (or the pending-approvals route) sees the
  // *_pending events immediately, before the run can be evicted.
  await flushRunEvents(run.messageId);
  await db
    .update(chats)
    .set({ activeRunStatus: 'awaiting_user' })
    .where(eq(chats.id, run.chatId))
    .execute();
}

// ── resumeRun ───────────────────────────────────────────────────────────────

export class StaleSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleSnapshotError';
  }
}
export class RaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RaceError';
  }
}
export class RunGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunGoneError';
  }
}

/**
 * Whether a resume response declines the proposed action (so no external state
 * is touched and the staleness guard is irrelevant). Only workspace/skill edits
 * carry a snapshot; their reject decisions are listed here.
 */
function isRejection(toolKind: ToolKind, response: unknown): boolean {
  const decision = (response as { decision?: string } | null | undefined)
    ?.decision;
  if (toolKind === 'workspace_edit' || toolKind === 'workspace_create') {
    return decision === 'reject' || decision === 'always_prompt';
  }
  if (toolKind === 'skill_edit') {
    return decision === 'reject';
  }
  return false;
}

/**
 * Guard against resuming against external state that changed while paused.
 * Compares the snapshot captured at interrupt time (file sha / skill content)
 * to the current value. Throws StaleSnapshotError on divergence.
 * ask_user / code_execution capture no external state and always pass.
 */
async function assertSnapshotFresh(
  approval: typeof approvalRequests.$inferSelect,
): Promise<void> {
  const snapshot = approval.snapshot as Record<string, unknown> | null;
  if (!snapshot) return;
  const payload = (approval.payload ?? {}) as Record<string, unknown>;

  if (
    approval.toolKind === 'workspace_edit' ||
    approval.toolKind === 'workspace_create'
  ) {
    const { getFileByName } = await import('@/lib/workspaces/files');
    const workspaceId = payload.workspaceId as string | undefined;
    const file = payload.file as string | undefined;
    if (!workspaceId || !file) return;
    const current = await getFileByName(workspaceId, file).catch(() => null);
    if (approval.toolKind === 'workspace_create') {
      if (current) {
        throw new StaleSnapshotError(
          `File "${file}" already exists; the proposed creation is stale.`,
        );
      }
    } else {
      if (!current) {
        throw new StaleSnapshotError(
          `File "${file}" no longer exists; the proposed edit is stale.`,
        );
      }
      const expectedSha = snapshot.existingFileSha as string | undefined;
      if (expectedSha && current.sha256 !== expectedSha) {
        throw new StaleSnapshotError(
          `File "${file}" changed since the edit was proposed; resolve again.`,
        );
      }
    }
    return;
  }

  if (approval.toolKind === 'skill_edit') {
    const { getUserSkillByName } = await import('@/lib/skills/service');
    const name = payload.name as string | undefined;
    const scope = payload.scope as string | undefined;
    if (!name) return;
    const workspaceId =
      scope === 'workspace'
        ? ((payload.workspaceId as string | null | undefined) ?? null)
        : null;
    const current = await getUserSkillByName(name, workspaceId).catch(
      () => null,
    );
    const existedThen = snapshot.existingSkillExists === true;
    if (existedThen !== !!current) {
      throw new StaleSnapshotError(
        `Skill "${name}" was ${current ? 'created' : 'deleted'} since the edit was proposed; resolve again.`,
      );
    }
    const expectedHash = snapshot.existingSkillContentHash as
      | string
      | null
      | undefined;
    if (current && expectedHash) {
      const currentHash = createHash('sha256')
        .update(current.content)
        .digest('hex');
      if (currentHash !== expectedHash) {
        throw new StaleSnapshotError(
          `Skill "${name}" changed since the edit was proposed; resolve again.`,
        );
      }
    }
  }
}

/** Find the markup tool-call id for an approval from its persisted pending event. */
function findMarkupToolCallId(
  run: Run,
  approval: typeof approvalRequests.$inferSelect,
): string | undefined {
  const pendingType = `${approval.toolKind}_pending`;
  const pendingEv = run.eventLog.find(
    (e) =>
      e.ev.type === pendingType &&
      (e.ev.data as Record<string, unknown>)?.approvalId === approval.id,
  );
  return (pendingEv?.ev.data as Record<string, unknown> | undefined)
    ?.markupToolCallId as string | undefined;
}

/** Resolve a stale approval: close its modal on all tabs (*_stale) and flip its
 *  tool-call widget to an error state. The run keeps going — the resumed tool
 *  returns an informative error so the agent can re-read and retry on its own. */
function emitStaleAndMarkup(
  run: Run,
  approval: typeof approvalRequests.$inferSelect,
  reason: string,
): void {
  pushEvent(run, {
    type: `${approval.toolKind}_stale`,
    data: { approvalId: approval.id, reason },
  });
  const markupToolCallId = findMarkupToolCallId(run, approval);
  if (!markupToolCallId) return;
  run.emitter.emit(
    'data',
    JSON.stringify({
      type: 'tool_call_error',
      data: { toolCallId: markupToolCallId, status: 'error', error: reason },
    }),
  );
}

/** Emit the answered event (closes modals on all tabs) + update the tool-call
 *  markup widget to a success state with response details. */
function emitAnsweredAndMarkup(
  run: Run,
  approval: typeof approvalRequests.$inferSelect,
  response: unknown,
): void {
  pushEvent(run, {
    type: `${approval.toolKind}_answered`,
    data: { approvalId: approval.id, response },
  });

  const markupToolCallId = findMarkupToolCallId(run, approval);
  if (!markupToolCallId) return;

  const res = (response ?? {}) as Record<string, unknown>;
  const extra: Record<string, string> = {};
  if (Array.isArray(res.selectedOptions) && res.selectedOptions.length)
    extra.selectedOptions = (res.selectedOptions as string[]).join(', ');
  if (typeof res.freeformText === 'string' && res.freeformText)
    extra.freeformText = res.freeformText.slice(0, 500);
  if (res.skipped) extra.skipped = 'true';
  if (res.decision === 'accept' || res.decision === 'accept_always')
    extra.decision = 'accepted';
  if (res.decision === 'reject' || res.decision === 'always_prompt')
    extra.decision = 'rejected';
  if (res.approved === false) extra.decision = 'denied';
  run.emitter.emit(
    'data',
    JSON.stringify({
      type: 'tool_call_success',
      data: { toolCallId: markupToolCallId, status: 'success', extra },
    }),
  );
}

type ResumeItem = { approvalId: string; response: unknown };

/**
 * Core resume path shared by single-approval and parallel (resumeMap) resume.
 * Returns once the resume is locked in the DB; the stream continues in the
 * background.
 */
async function performResume(items: ResumeItem[]): Promise<void> {
  if (items.length === 0) throw new RunGoneError('No approvals to resume');
  const ids = items.map((i) => i.approvalId);

  for (const id of ids) {
    if (resumeLocks.has(id)) {
      throw new RaceError(`Resume for approval ${id} already in progress`);
    }
  }
  ids.forEach((id) => resumeLocks.add(id));
  try {
    // Load + validate every approval up front.
    const approvals = new Map<string, typeof approvalRequests.$inferSelect>();
    for (const id of ids) {
      const a = await db.query.approvalRequests.findFirst({
        where: eq(approvalRequests.id, id),
      });
      if (!a) throw new RunGoneError(`Approval ${id} not found`);
      if (a.resolvedAt != null)
        throw new RaceError(`Approval ${id} already resolved`);
      approvals.set(id, a);
    }
    const first = approvals.get(ids[0])!;
    for (const a of approvals.values()) {
      if (a.messageId !== first.messageId) {
        throw new RunGoneError('Approvals span multiple runs');
      }
    }

    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, first.chatId),
    });
    if (!chat?.activeRunThreadId)
      throw new RunGoneError(`Run for ${first.messageId} has no active thread`);

    const { SimplifiedAgent } = await import('@/lib/search/simplifiedAgent');
    const { resolveChatAndEmbedding } =
      await import('@/lib/providers/resolveModels');
    const { getRun } = await import('./runHub');

    const snapshot = chat.activeRunConfigSnapshot as Record<
      string,
      unknown
    > | null;
    if (!snapshot)
      throw new RunGoneError(`No config snapshot for ${first.messageId}`);

    const userMessageId = first.messageId;

    let run = getRun(userMessageId);
    if (!run) run = await reconstructAwaitingRun(chat, snapshot);

    if (run.status !== 'awaiting_user') {
      throw new RaceError(
        `Run ${userMessageId} is not awaiting_user (status: ${run.status})`,
      );
    }

    const resolved = await resolveChatAndEmbedding({
      chatModel: snapshot.chatModelRef as {
        provider: string;
        name: string;
      } | null,
      systemModel: snapshot.systemModelRef as {
        provider: string;
        name: string;
      } | null,
    });

    // Count unresolved interrupts BEFORE marking resolved. With more than one
    // pending, even a partial resume must use the engine-keyed map form so the
    // un-resumed interrupts stay pending; a single interrupt uses a bare value.
    const pendingForRun = await getPendingApprovalsForMessage(userMessageId);
    const useKeyedMap = pendingForRun.length > 1;

    // Stale-state guard for each approval. If external state changed while paused
    // (file sha / skill content), the approved preview can't be applied verbatim —
    // but rather than killing the whole run, convert that approval into a synthetic
    // "stale" rejection. The resumed tool recognizes it and returns an informative
    // error, so the agent can re-read and retry on its own. Rejections skip the
    // check: a rejected edit is never applied, so underlying changes don't matter.
    const responseById = new Map(items.map((i) => [i.approvalId, i.response]));
    const staleReasons = new Map<string, string>();
    for (const a of approvals.values()) {
      if (isRejection(a.toolKind, responseById.get(a.id))) continue;
      try {
        await assertSnapshotFresh(a);
      } catch (e) {
        if (e instanceof StaleSnapshotError) {
          staleReasons.set(a.id, e.message);
          continue;
        }
        throw e;
      }
    }

    // Swap stale approvals' responses for a synthetic marker the tools recognize.
    const effectiveItems: ResumeItem[] = items.map((i) =>
      staleReasons.has(i.approvalId)
        ? {
            approvalId: i.approvalId,
            response: { __stale: true, reason: staleReasons.get(i.approvalId) },
          }
        : i,
    );

    // Mark each resolved (first-write-wins via WHERE resolvedAt IS NULL).
    for (const { approvalId, response } of effectiveItems) {
      const result = await db
        .update(approvalRequests)
        .set({
          resolvedAt: Date.now(),
          response,
          resolutionKind: staleReasons.has(approvalId)
            ? 'stale_snapshot'
            : 'user',
        })
        .where(
          and(
            eq(approvalRequests.id, approvalId),
            isNull(approvalRequests.resolvedAt),
          ),
        )
        .execute();
      if ((result as unknown as { changes?: number })?.changes === 0) {
        throw new RaceError(
          `Race: approval ${approvalId} resolved by another request`,
        );
      }
    }

    setRunStatus(run, 'running');
    await db
      .update(chats)
      .set({ activeRunStatus: 'running' })
      .where(eq(chats.id, run.chatId))
      .execute();

    for (const { approvalId, response } of effectiveItems) {
      const approval = approvals.get(approvalId)!;
      const staleReason = staleReasons.get(approvalId);
      if (staleReason) emitStaleAndMarkup(run, approval, staleReason);
      else emitAnsweredAndMarkup(run, approval, response);
    }

    const handler = new SimplifiedAgent(
      resolved.chatLlm,
      resolved.systemLlm,
      resolved.embedding,
      run.emitter,
      (snapshot.personaInstructions as string) ?? '',
      run.abortController.signal,
      userMessageId,
      run.retrievalController.signal,
      snapshot.userLocation as string | undefined,
      snapshot.userProfile as string | undefined,
      (snapshot.memoryEnabled as boolean) ?? false,
      '',
      (snapshot.chatId as string) ?? run.chatId,
      (snapshot.interactiveSession as boolean) ?? true,
      (snapshot.methodologyInstructions as string) ?? '',
      (snapshot.isPrivate as boolean) ?? false,
      undefined,
      (snapshot.workspaceSuffix as string) ?? '',
      snapshot.workspaceId as string | null | undefined,
      (snapshot.aiMessageId as string) ?? run.aiMessageId,
    );
    handler.setThreadId(chat.activeRunThreadId);
    handler.setModelRefs(
      snapshot.chatModelRef as { provider: string; name: string },
      snapshot.systemModelRef as { provider: string; name: string } | null,
    );

    // Single pending interrupt → bare value; multiple → map keyed by the
    // engine interrupt id so LangGraph routes each value to the right interrupt.
    let resumeArg: unknown;
    if (useKeyedMap) {
      const map: Record<string, unknown> = {};
      for (const { approvalId, response } of effectiveItems) {
        const a = approvals.get(approvalId)!;
        map[a.engineInterruptId ?? a.id] = response;
      }
      resumeArg = map;
    } else {
      resumeArg = effectiveItems[0].response;
    }

    const resumedRun = run;
    handler
      .doResume(
        (snapshot.focusMode as string) ?? 'webSearch',
        (snapshot.fileIds as string[]) ?? [],
        resumeArg,
      )
      .catch((err: unknown) => {
        console.error('[resumeRun] doResume error:', err);
        // Without this the run stays `running` forever on a doResume failure
        // (no `end`/`error` event ⇒ terminate() never fires). Emit `error` on
        // the run emitter so the run transitions to `errored` and clients stop
        // spinning. The handler's `terminated` guard makes this a no-op if the
        // run already completed.
        try {
          resumedRun.emitter.emit(
            'error',
            JSON.stringify({ data: String(err) }),
          );
        } catch {
          // emitter already torn down; nothing more to do
        }
      });
  } finally {
    ids.forEach((id) => resumeLocks.delete(id));
  }
}

/** Resume a paused awaiting_user run from a single answered approval. */
export async function resumeRun(
  approvalId: string,
  response: unknown,
): Promise<void> {
  return performResume([{ approvalId, response }]);
}

/** Resume multiple parallel interrupts at once (approvalId → response). */
export async function resumeRunMulti(
  resumeMap: Record<string, unknown>,
): Promise<void> {
  return performResume(
    Object.entries(resumeMap).map(([approvalId, response]) => ({
      approvalId,
      response,
    })),
  );
}

// ── reconstructAwaitingRun ───────────────────────────────────────────────────

async function reconstructAwaitingRun(
  chat: typeof chats.$inferSelect,
  snapshot: Record<string, unknown>,
): Promise<Run> {
  const { EventEmitter } = await import('events');
  const emitter = new EventEmitter();
  const abortController = new AbortController();
  const retrievalController = new AbortController();

  const messageId = chat.activeRunMessageId ?? '';

  // Register the fresh controllers so a Stop (POST /api/chat/cancel) can reach
  // this run. Without this, a reconstructed run (after eviction or a server
  // restart) has no entry in the cancel-token map and Stop silently 404s,
  // leaving the chat stuck in awaiting_user. Also clear any stale soft-stop
  // flag a prior 404'd Stop may have set, so the resumed agent doesn't halt
  // immediately.
  registerCancelToken(messageId, abortController);
  registerRetrieval(messageId, retrievalController);
  clearSoftStop(messageId);

  // The assistant message row is keyed by aiMessageId (distinct from the user
  // message id stored in activeRunMessageId). Recover it from the config
  // snapshot so content persistence + event routing target the right row.
  const aiMessageId =
    (snapshot.aiMessageId as string | undefined) ??
    chat.activeRunMessageId ??
    '';

  // Load persisted assistant content so post-resume tokens append correctly
  let persistedContent = '';
  if (aiMessageId) {
    try {
      const aiMsg = await db.query.messages.findFirst({
        where: eq(messagesSchema.messageId, aiMessageId),
      });
      if (aiMsg?.role === 'assistant' && typeof aiMsg.content === 'string') {
        persistedContent = aiMsg.content;
      }
    } catch {
      // Non-critical; fallback to empty
    }
  }

  // Load persisted run_events to seed eventLog
  const persistedEvents = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.messageId, messageId));

  const run: Run = {
    chatId: chat.id,
    messageId,
    aiMessageId,
    threadId: chat.activeRunThreadId ?? '',
    status: 'awaiting_user' as RunStatus,
    emitter,
    eventLog: persistedEvents.map((e) => ({
      seq: e.seq,
      ev: e.data as Record<string, unknown>,
    })),
    subscribers: new Map(),
    abortController,
    retrievalController,
    seq: Math.max(0, ...persistedEvents.map((e) => e.seq)),
    startedAt: chat.activeRunStartedAt ?? Date.now(),
    recievedMessage: persistedContent,
  };

  registerReconstructedRun(run);
  await attachResumedRunHost(run);

  return run;
}

/**
 * Wire up event listeners for the run's EventEmitter.
 *
 * For new runs (`isResume` omitted or false):
 *   - Inserts an empty assistant row and writes the chat active-run markers.
 *   - Seeds recievedMessage from empty string.
 *
 * For resumed runs (`isResume: true`, called by attachResumedRunHost):
 *   - Skips DB init (row and markers already exist).
 *   - Seeds recievedMessage from run.recievedMessage (persisted pre-pause content).
 *   - Seeds markup correlation maps from the run's eventLog.
 *
 * Having a single function avoids duplicating the event-handling logic.
 */
export async function attachRunHost(params: {
  run: Run;
  startTime: number;
  userMessageId: string;
  usedLocation: boolean;
  usedPersonalization: boolean;
  memoriesUsed: Array<{ id: string; content: string }>;
  configSnapshot?: Record<string, unknown> | null;
  isResume?: boolean;
}): Promise<void> {
  const {
    run,
    startTime,
    userMessageId,
    usedLocation,
    usedPersonalization,
    memoriesUsed,
    configSnapshot,
    isResume = false,
  } = params;
  const { emitter, aiMessageId, chatId } = run;

  if (!isResume) {
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
        activeRunStatus: 'running',
        activeRunThreadId: run.threadId,
        activeRunConfigSnapshot: configSnapshot ?? null,
        lastRunViewed: 0,
      })
      .where(eq(chats.id, chatId))
      .execute();
  }

  // For resumed runs, seed from the persisted pre-pause content so post-resume
  // tokens APPEND rather than overwrite. For new runs, start from empty.
  let recievedMessage = isResume ? run.recievedMessage : '';

  // Markup-correlation maps: code_execution_result and user_question_answered
  // need these to update the right ToolCall widget in the saved markup.
  // For resumed runs, seed from the eventLog so the pre-pause pending events
  // are available even if the original pushCallbackRunId Map is empty (e.g.,
  // after restart + lazy reconstruction).
  const codeExecutionRunIdMap = new Map<string, string>();
  const userQuestionRunIdMap = new Map<string, string>();
  if (isResume) {
    for (const { ev } of run.eventLog) {
      const d = (ev.data ?? ev) as Record<string, unknown>;
      if (ev.type === 'code_execution_pending') {
        const runId = d.markupToolCallId as string | undefined;
        if (runId) {
          if (d.approvalId)
            codeExecutionRunIdMap.set(d.approvalId as string, runId);
          if (d.executionId)
            codeExecutionRunIdMap.set(d.executionId as string, runId);
          if (d.toolCallId)
            codeExecutionRunIdMap.set(d.toolCallId as string, runId);
        }
      } else if (
        ev.type === 'user_question_pending' ||
        ev.type === 'ask_user_pending'
      ) {
        const runId = d.markupToolCallId as string | undefined;
        if (runId) {
          const qId = (d.approvalId ?? d.questionId) as string | undefined;
          if (qId) userQuestionRunIdMap.set(qId, runId);
        }
      }
    }
  }
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
    await flushRunEvents(run.messageId);
    dropRunEventBuffer(run.messageId);
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
        activeRunStatus: null,
        activeRunThreadId: null,
        activeRunConfigSnapshot: null,
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
    if (!run.retrievalController.signal.aborted) {
      run.retrievalController.abort();
    }

    const doCancelAsync = async () => {
      // Capture pending approvals BEFORE marking them resolved so we can emit
      // per-tool *_cancelled events to close specific modals on all tabs.
      const pendingForCancel = await getPendingApprovalsForMessage(
        run.messageId,
      ).catch(() => [] as (typeof approvalRequests.$inferSelect)[]);

      // Clean up the LangGraph checkpoint (whether we were running or awaiting_user)
      await deleteCheckpoint(run.threadId).catch((e: unknown) =>
        console.warn('[runHost] deleteCheckpoint on cancel failed:', e),
      );
      await markOpenApprovalsCancelled(run.messageId).catch(console.warn);

      // Stop any in-flight tool widgets from spinning forever in the saved markup.
      recievedMessage = scrubRunningToolMarkup(recievedMessage);

      // Emit per-tool *_cancelled events so each modal closes on all attached tabs.
      for (const p of pendingForCancel) {
        pushEvent(run, {
          type: `${p.toolKind}_cancelled`,
          data: { approvalId: p.id },
        });
      }

      pushEvent(run, { type: 'error', data: 'Request cancelled by user' });

      await terminate('cancelled', {
        createdAt: new Date(),
        runStatus: 'cancelled',
        ...(sources.length > 0 && { sources }),
        ...(searchQuery && { searchQuery }),
        ...(searchUrl && { searchUrl }),
        ...(Object.keys(chartSpecs).length > 0 && { chartSpecs }),
      });
    };

    doCancelAsync().catch(console.warn);
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
    } else if (
      parsedData.type === 'panel_executor_started' ||
      parsedData.type === 'panel_executor_data' ||
      parsedData.type === 'panel_executor_completed' ||
      parsedData.type === 'panel_executor_error'
    ) {
      pushEvent(run, { ...parsedData, messageId: aiMessageId });
      const idx = parsedData.executorIdx as number;
      if (parsedData.type === 'panel_executor_started') {
        recievedMessage = applyPanelExecutorStarted(
          recievedMessage,
          idx,
          parsedData.model ?? `Model ${idx + 1}`,
        );
      } else if (parsedData.type === 'panel_executor_data') {
        recievedMessage = applyPanelExecutorResponseToken(
          recievedMessage,
          idx,
          parsedData.token ?? '',
        );
      } else if (parsedData.type === 'panel_executor_completed') {
        recievedMessage = applyPanelExecutorStatus(
          recievedMessage,
          idx,
          'success',
          {
            sourceCount: parsedData.sourceCount,
            tokens: panelExecutorTokens(parsedData.usage),
            model: parsedData.model,
          },
        );
      } else if (parsedData.type === 'panel_executor_error') {
        recievedMessage = applyPanelExecutorStatus(
          recievedMessage,
          idx,
          'error',
          {
            error: parsedData.error,
            model: parsedData.model,
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

  emitter.on('interrupts', async (data: string) => {
    if (terminated) return;
    try {
      const interrupts = JSON.parse(data) as LangGraphInterrupt[];
      await handleInterrupts(run, interrupts);
    } catch (err) {
      console.error('[runHost] handleInterrupts failed:', err);
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

    // Delete LangGraph checkpoint on clean completion (no further resumes needed)
    deleteCheckpoint(run.threadId).catch((e: unknown) =>
      console.warn('[runHost] checkpoint delete on completion failed:', e),
    );

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

    deleteCheckpoint(run.threadId).catch(console.warn);
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

/**
 * Attach event listeners to a lazily-reconstructed awaiting_user run.
 * Delegates to attachRunHost with isResume:true, which skips DB init and
 * seeds recievedMessage + markup-correlation maps from the existing run state.
 */
export async function attachResumedRunHost(run: Run): Promise<void> {
  return attachRunHost({
    run,
    userMessageId: run.messageId,
    startTime: Date.now(),
    usedLocation: false,
    usedPersonalization: false,
    memoriesUsed: [],
    configSnapshot: null,
    isResume: true,
  });
}
