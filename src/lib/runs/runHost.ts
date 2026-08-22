import {
  appendWidget,
  updateWidget,
  upsertNestedToolCall,
  patchNestedToolCall,
  startPanelColumn,
  appendPanelColumnToken,
  setPanelColumnStatus,
  appendChartWidget,
  appendPanelColumnChart,
  neutralizeSpoofedFences,
  upsertArtifactWidget,
  type ToolCallPayload,
  type SubagentPayload,
} from '@/lib/widgets/envelope';
import {
  stripPanelColumnModelTags,
  stripStreamedChartTags,
} from '@/lib/utils/contentStripping';
import { ChartSpecSchema, type ChartSpec } from '@/lib/chart/chartSpec';
import { resolveChartPlacement } from '@/lib/chart/placement';
import {
  restoreTurnChartRegistryFromMilestones,
  TurnChartRegistry,
} from '@/lib/chart/turnChartRegistry';
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
import {
  emitStreamEvent,
  onStreamEvent,
  normalizeStreamEvent,
  panelExecutorTokens,
  type ModelStats,
  type ModelStatsV2,
  type ToolKind,
  type LangGraphInterrupt,
  type StreamEvent,
} from '@/lib/streaming/events';
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
import { eq, sql, and, isNull, ne, asc } from 'drizzle-orm';
import { createHash } from 'crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Document } from '@langchain/core/documents';
import type { Recorder, TokenTracker } from '@/lib/tokens/tracker';
import { generateChatTitle } from '@/lib/utils/chatTitle';
import { popCallbackRunId } from '@/lib/sandbox/codeExecutionCorrelation';
import { popCallbackRunId as popQuestionCallbackRunId } from '@/lib/userQuestion/questionCorrelation';
import {
  decodeAgentRunConfig,
  encodeAgentRunConfig,
  type AgentRunConfig,
} from '@/lib/search/agentRunConfig';
import { deduplicateDocuments } from '@/lib/search/agentStreamDriver';

// ── Types ──────────────────────────────────────────────────────────────────

// In-memory lock to prevent concurrent resumes for the same approvalId
const resumeLocks = new Set<string>();

// Persist milestone events for cross-restart reconstruction. Registered once.
setEventPersister((run, seqEvent) => {
  enqueueRunEvent(run.messageId, run.chatId, seqEvent);
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Rewrite any still-"running" tool/subagent widgets in persisted content to a
 * terminal state. On cancel the run is over, so nothing should keep spinning;
 * without this a cancelled chat renders frozen spinners for the in-flight tool.
 * Handles both the current fenced-JSON format and legacy `status="running"`
 * attribute markup (old messages, no data migration).
 */
function scrubRunningToolMarkup(content: string): string {
  return content
    .replace(/"status":"running"/g, '"status":"error"')
    .replace(/status="running"/g, 'status="error"');
}

function isModelStatsV2(value: unknown): value is ModelStatsV2 {
  if (!value || typeof value !== 'object') return false;
  const stats = value as Partial<ModelStatsV2>;
  return stats.version === 2 && Array.isArray(stats.perModel);
}

function latestModelStatsV2(
  eventLog: readonly { ev: StreamEvent }[],
): ModelStatsV2 | undefined {
  for (let i = eventLog.length - 1; i >= 0; i--) {
    const event = eventLog[i]?.ev;
    if (event?.type === 'stats' && isModelStatsV2(event.data)) {
      return event.data;
    }
  }
  return undefined;
}

function sourcesFromEventLog(
  eventLog: readonly { ev: StreamEvent }[],
): Document[] {
  let sources: Document[] = [];
  for (const { ev } of eventLog) {
    if (ev.type === 'sources') {
      sources = deduplicateDocuments(ev.data);
    } else if (ev.type === 'sources_added') {
      sources = deduplicateDocuments([...sources, ...ev.data]);
    }
  }
  return sources;
}

function addModelStatsDelta(
  base: ModelStatsV2,
  before: ModelStatsV2,
  after: ModelStatsV2,
): ModelStatsV2 {
  const beforeByModel = new Map(
    before.perModel.map((row) => [`${row.provider}::${row.model}`, row.usage]),
  );
  const rows = base.perModel.map((row) => ({
    ...row,
    usage: { ...row.usage },
  }));

  for (const row of after.perModel) {
    const key = `${row.provider}::${row.model}`;
    const prior = beforeByModel.get(key);
    const delta = {
      input_tokens: Math.max(
        0,
        row.usage.input_tokens - (prior?.input_tokens ?? 0),
      ),
      output_tokens: Math.max(
        0,
        row.usage.output_tokens - (prior?.output_tokens ?? 0),
      ),
      total_tokens: Math.max(
        0,
        row.usage.total_tokens - (prior?.total_tokens ?? 0),
      ),
    };
    if (
      delta.input_tokens === 0 &&
      delta.output_tokens === 0 &&
      delta.total_tokens === 0
    ) {
      continue;
    }

    const existing = rows.find(
      (candidate) =>
        candidate.provider === row.provider && candidate.model === row.model,
    );
    if (existing) {
      existing.usage = {
        input_tokens: existing.usage.input_tokens + delta.input_tokens,
        output_tokens: existing.usage.output_tokens + delta.output_tokens,
        total_tokens: existing.usage.total_tokens + delta.total_tokens,
      };
    } else {
      rows.push({
        provider: row.provider,
        model: row.model,
        usage: delta,
      });
    }
  }

  return { ...base, perModel: rows };
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

// ── auto-title ────────────────────────────────────────────────────────────────

/** Title generation is only attempted when a run carries this context. */
export type TitleGenContext = {
  systemLlm: BaseChatModel;
  systemRecorder: Recorder;
  tracker: TokenTracker;
  autoTitleEnabled: boolean;
};

/** Wall-clock budget for the title call before we give up and keep the raw title. */
const TITLE_GEN_TIMEOUT_MS = 10_000;

/**
 * Summarize the first turn into a chat title and persist it, if eligible.
 * Eligible ⇔ auto-title is on, the chat isn't a scheduled-task chat, its title
 * isn't manually locked, and this is the chat's first assistant message. On
 * success the DB title is updated (lock stays off) and a `chatTitle` wire event
 * is pushed so an in-view chat updates live. Best-effort: any failure/timeout/
 * empty result keeps the raw first-message title. Returns whether it changed.
 */
async function maybeGenerateTitle(params: {
  run: Run;
  chatId: string;
  aiMessageId: string;
  answer: string;
  ctx: TitleGenContext;
}): Promise<boolean> {
  const { run, chatId, aiMessageId, answer, ctx } = params;
  try {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
    });
    if (!chat || chat.scheduleId || chat.titleLocked) return false;

    // First-turn gate: skip if any earlier assistant message already exists.
    const priorAssistant = await db.query.messages.findFirst({
      where: and(
        eq(messagesSchema.chatId, chatId),
        eq(messagesSchema.role, 'assistant'),
        ne(messagesSchema.messageId, aiMessageId),
      ),
    });
    if (priorAssistant) return false;

    const firstUser = await db.query.messages.findFirst({
      where: and(
        eq(messagesSchema.chatId, chatId),
        eq(messagesSchema.role, 'user'),
      ),
      orderBy: asc(messagesSchema.id),
    });
    if (!firstUser?.content) return false;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TITLE_GEN_TIMEOUT_MS);
    let title: string | null;
    try {
      title = await generateChatTitle(
        ctx.systemLlm,
        ctx.systemRecorder,
        firstUser.content,
        answer,
        ac.signal,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!title) return false;

    await db.update(chats).set({ title }).where(eq(chats.id, chatId)).execute();

    pushEvent(run, {
      type: 'chatTitle',
      chatId,
      title,
      messageId: aiMessageId,
    });
    return true;
  } catch (err) {
    console.warn('[runHost] auto-title generation failed:', err);
    return false;
  }
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

    // pushEvent enqueues the *_pending event via the registered persister.
    pushEvent(run, {
      type: `${kind}_pending`,
      data: { approvalId: i.id, toolCallId, markupToolCallId, ...payload },
      messageId: run.aiMessageId,
    });
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
  if (toolKind === 'mcp_tool') {
    return (
      (response as { approved?: boolean } | null | undefined)?.approved ===
      false
    );
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
      string | null | undefined;
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
      (e.ev as { data?: Record<string, unknown> }).data?.approvalId ===
        approval.id,
  );
  return (pendingEv?.ev as { data?: Record<string, unknown> } | undefined)?.data
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
  emitStreamEvent(run.emitter, {
    type: 'tool_call_error',
    data: { toolCallId: markupToolCallId, status: 'error', error: reason },
  });
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
  const extra: Record<string, string | boolean> = {};
  if (Array.isArray(res.selectedOptions) && res.selectedOptions.length)
    extra.selectedOptions = (res.selectedOptions as string[]).join(', ');
  if (typeof res.freeformText === 'string' && res.freeformText)
    extra.freeformText = res.freeformText.slice(0, 500);
  if (res.skipped) extra.skipped = true;
  if (res.decision === 'accept' || res.decision === 'accept_always')
    extra.decision = 'accepted';
  if (res.decision === 'reject' || res.decision === 'always_prompt')
    extra.decision = 'rejected';
  if (res.approved === false) extra.decision = 'denied';
  emitStreamEvent(run.emitter, {
    type: 'tool_call_success',
    data: { toolCallId: markupToolCallId, status: 'success', extra },
  });
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
    if (!chat) throw new RunGoneError(`Chat for ${first.messageId} not found`);

    let runConfig: AgentRunConfig;
    try {
      runConfig = decodeAgentRunConfig(chat.activeRunConfigSnapshot);
    } catch (err) {
      const detail = err instanceof Error ? `: ${err.message}` : '';
      throw new RunGoneError(
        `Run for ${first.messageId} has no valid resumable config${detail}`,
      );
    }
    if (!chat.activeRunThreadId)
      throw new RunGoneError(`Run for ${first.messageId} has no active thread`);

    const { SimplifiedAgent } = await import('@/lib/search/simplifiedAgent');
    const { resolveChatAndEmbedding } =
      await import('@/lib/providers/resolveModels');
    const { getRun } = await import('./runHub');

    if (
      !runConfig.interactiveSession ||
      !runConfig.chatId ||
      !runConfig.messageId ||
      !runConfig.aiMessageId ||
      runConfig.chatId !== first.chatId ||
      runConfig.messageId !== first.messageId
    ) {
      throw new RunGoneError(
        `Run for ${first.messageId} has incomplete or mismatched resumable identity`,
      );
    }
    const userMessageId = runConfig.messageId;

    let run = getRun(userMessageId);
    if (!run) run = await reconstructAwaitingRun(chat, runConfig);

    if (run.status !== 'awaiting_user') {
      throw new RaceError(
        `Run ${userMessageId} is not awaiting_user (status: ${run.status})`,
      );
    }

    const resolved = await resolveChatAndEmbedding({
      chatModel: runConfig.chatModelRef,
      systemModel: runConfig.systemModelRef,
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

    const { createTurnTracker } = await import('@/lib/tokens/tracker');
    const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
      run.emitter,
      runConfig.chatModelRef,
      runConfig.systemModelRef,
    );
    const prePauseStats = latestModelStatsV2(run.eventLog);
    if (prePauseStats) tracker.seed(prePauseStats);

    const handler = new SimplifiedAgent({
      dependencies: {
        chatLlm: resolved.chatLlm,
        systemLlm: resolved.systemLlm,
        embeddings: resolved.embedding,
        emitter: run.emitter,
        tokenTracking: { tracker, chatRecorder, systemRecorder },
      },
      run: runConfig,
      context: {
        signal: run.abortController.signal,
        retrievalSignal: run.retrievalController.signal,
        threadId: chat.activeRunThreadId,
        memorySection: '',
        invokedSkillNames: [],
        chartRegistry: run.chartRegistry,
      },
    });
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

    // Extract pinned MCP descriptor snapshots from the approvals being resumed.
    // The approvals Map still holds the full row data here even though the DB
    // rows were already marked resolved above — so we read from memory, not DB.
    const pinnedMcpDescriptors = effectiveItems
      .map(({ approvalId }) => approvals.get(approvalId)!)
      .filter((a) => a.toolKind === 'mcp_tool')
      .map(
        (a) =>
          (a.payload as Record<string, unknown> | null)?._descriptorSnapshot as
            import('@/lib/mcp/types').McpToolDescriptor | undefined,
      )
      .filter(
        (s): s is import('@/lib/mcp/types').McpToolDescriptor => s != null,
      );

    // Map each resumed MCP approval's LLM toolCallId → the widget's markup
    // toolCallId, so doResume can attach the tool's response to the correct
    // <ToolCall> widget (the widget is keyed by the original run's id, not the
    // resume callback's runId). Keyed by LLM toolCallId for collision-safety
    // when the same MCP tool is called multiple times in one message.
    const mcpMarkupIds: Record<string, string> = {};
    for (const { approvalId } of effectiveItems) {
      const a = approvals.get(approvalId)!;
      if (a.toolKind !== 'mcp_tool' || !a.toolCallId) continue;
      const markupId = findMarkupToolCallId(run, a);
      if (markupId) mcpMarkupIds[a.toolCallId] = markupId;
    }

    const existingDocuments = sourcesFromEventLog(run.eventLog);
    const resumedRun = run;
    handler
      .doResume({
        resumeArg,
        pinnedMcpDescriptors,
        mcpMarkupIds,
        existingDocuments,
      })
      .catch((err: unknown) => {
        console.error('[resumeRun] doResume error:', err);
        // Without this the run stays `running` forever on a doResume failure
        // (no `end`/`error` event ⇒ terminate() never fires). Emit `error` on
        // the run emitter so the run transitions to `errored` and clients stop
        // spinning. The handler's `terminated` guard makes this a no-op if the
        // run already completed.
        try {
          emitStreamEvent(resumedRun.emitter, {
            type: 'agent_error',
            data: String(err),
          });
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
  runConfig: AgentRunConfig,
): Promise<Run> {
  const { EventEmitter } = await import('events');
  const emitter = new EventEmitter();
  const abortController = new AbortController();
  const retrievalController = new AbortController();

  if (!runConfig.messageId || !runConfig.aiMessageId) {
    throw new RunGoneError('Run config has no resumable message identity');
  }
  if (!chat.activeRunThreadId) {
    throw new RunGoneError('Run has no active checkpoint thread');
  }
  const messageId = runConfig.messageId;

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
  const aiMessageId = runConfig.aiMessageId;

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
    .where(eq(runEvents.messageId, messageId))
    .orderBy(asc(runEvents.seq));
  const eventLog = persistedEvents.map((e) => ({
    seq: e.seq,
    // Persisted rows may use pre-canonical approval type names; normalize so
    // resume seeding and replay match the current vocabulary.
    ev: normalizeStreamEvent(e.data) as StreamEvent,
  }));
  const chartRegistry = new TurnChartRegistry();
  restoreTurnChartRegistryFromMilestones(
    chartRegistry,
    eventLog.map(({ ev }) => ev),
  );

  const run: Run = {
    chatId: chat.id,
    messageId,
    aiMessageId,
    threadId: chat.activeRunThreadId,
    status: 'awaiting_user' as RunStatus,
    emitter,
    eventLog,
    subscribers: new Map(),
    abortController,
    retrievalController,
    seq: Math.max(0, ...persistedEvents.map((e) => e.seq)),
    startedAt: chat.activeRunStartedAt ?? Date.now(),
    recievedMessage: persistedContent,
    chartRegistry,
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
  configSnapshot?: AgentRunConfig | null;
  isResume?: boolean;
  /** When present, the first assistant turn's completion generates a chat title. */
  titleGen?: TitleGenContext;
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
    titleGen,
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
        activeRunConfigSnapshot: configSnapshot
          ? encodeAgentRunConfig(configSnapshot)
          : null,
        lastRunViewed: 0,
      })
      .where(eq(chats.id, chatId))
      .execute();
  }

  // For resumed runs, seed from the persisted pre-pause content so post-resume
  // tokens APPEND rather than overwrite. For new runs, start from empty.
  let recievedMessage = isResume ? run.recievedMessage : '';
  if (isResume) {
    restoreTurnChartRegistryFromMilestones(
      run.chartRegistry,
      run.eventLog.map(({ ev }) => ev),
    );
  }

  // Markup-correlation maps: code_execution_result and user_question_answered
  // need these to update the right ToolCall widget in the saved markup.
  // For resumed runs, seed from the eventLog so the pre-pause pending events
  // are available even if the original pushCallbackRunId Map is empty (e.g.,
  // after restart + lazy reconstruction).
  const codeExecutionRunIdMap = new Map<string, string>();
  const userQuestionRunIdMap = new Map<string, string>();
  if (isResume) {
    for (const { ev } of run.eventLog) {
      const d = ((ev as { data?: unknown }).data ?? ev) as Record<
        string,
        unknown
      >;
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
      } else if (ev.type === 'ask_user_pending') {
        const runId = d.markupToolCallId as string | undefined;
        if (runId) {
          const qId = (d.approvalId ?? d.questionId) as string | undefined;
          if (qId) userQuestionRunIdMap.set(qId, runId);
        }
      }
    }
  }
  const chartSpecs: Record<string, ChartSpec> = {};
  const shownChartIds = new Set<string>();
  for (const { ev } of run.eventLog) {
    if (ev.type === 'chart_spec') {
      const chartId = ev.data.chartId;
      const parsed = ChartSpecSchema.safeParse(ev.data.spec);
      if (chartId && parsed.success) chartSpecs[chartId] = parsed.data;
    } else if (ev.type === 'chart_placement') {
      if (ev.data.chartId && ev.data.placementId) {
        shownChartIds.add(ev.data.chartId);
      }
    } else if (ev.type === 'panel_executor_chart') {
      if (ev.data.chartId && ev.data.placementId) {
        shownChartIds.add(ev.data.chartId);
      }
    }
  }
  const visibleChartMetadata = (): Record<string, ChartSpec> => {
    const visible: Record<string, ChartSpec> = {};
    for (const chartId of shownChartIds) {
      const spec = chartSpecs[chartId];
      if (spec) visible[chartId] = spec;
    }
    return visible;
  };

  // A placement milestone can outlive the last partial-content flush when a
  // process pauses for approval or restarts. Rebuild its writer envelope before
  // replay_complete is sent so the authoritative accumulated content cannot
  // erase a chart the replay reducer just restored from milestones.
  if (isResume) {
    for (const { ev } of run.eventLog) {
      if (ev.type === 'chart_placement') {
        const payload = resolveChartPlacement(chartSpecs, ev.data);
        if (payload) {
          recievedMessage = appendChartWidget(recievedMessage, payload);
        }
      } else if (ev.type === 'panel_executor_chart') {
        const payload = resolveChartPlacement(chartSpecs, ev.data);
        if (payload) {
          recievedMessage = appendPanelColumnChart(
            recievedMessage,
            ev.executorIdx,
            payload,
          );
        }
      }
    }
    run.recievedMessage = recievedMessage;
  }

  let sources: Document[] = isResume ? sourcesFromEventLog(run.eventLog) : [];
  let searchQuery: string | undefined;
  let searchUrl: string | undefined;
  let modelStats: ModelStats = (isResume &&
    latestModelStatsV2(run.eventLog)) || {
    version: 2,
    perModel: [],
  };
  let terminated = false;
  // Set once `messageEnd` is on the wire. After that, late recorder activity
  // (the auto-title system call) must not push another `stats` event — the
  // corrected totals ride to the DB via terminate, and a post-end `stats` would
  // wrongly re-show the live stats bar / context chip.
  let messageEnded = false;

  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleFlush = (immediate: boolean) => {
    // Mirror onto the in-memory run immediately, ahead of the (possibly
    // debounced) DB write below — a reconnecting client's replay boundary is
    // seeded from this field (see runHub.subscribe's replay_complete), and it
    // must never lag behind what's already been broadcast over SSE.
    run.recievedMessage = recievedMessage;
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
        ...(Object.keys(visibleChartMetadata()).length > 0 && {
          chartSpecs: visibleChartMetadata(),
        }),
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
        ...(Object.keys(visibleChartMetadata()).length > 0 && {
          chartSpecs: visibleChartMetadata(),
        }),
      });
    };

    doCancelAsync().catch(console.warn);
  });

  // Single typed handler for every event on the run's emitter. Wire-bound
  // events are pushed (after markup accumulation); control events are
  // translated (model_stats→stats) or drive lifecycle (interrupt, agent_end,
  // agent_error). tool_llm_usage is the agent's own signal and is ignored here.
  onStreamEvent(emitter, async (event) => {
    if (terminated) return;

    if (event.type === 'response') {
      // Neutralize before either the wire push or persistence: a model can
      // never forge a widget, and both the live stream and persisted content
      // must agree (the client reducer's own neutralization is defense in
      // depth, not the sole guard).
      const data = neutralizeSpoofedFences(event.data);
      pushEvent(run, {
        type: 'response',
        data,
        messageId: aiMessageId,
      });
      recievedMessage = stripStreamedChartTags(recievedMessage + data);
      scheduleFlush(false);
    } else if (event.type === 'sources' || event.type === 'sources_added') {
      if (event.searchQuery) searchQuery = event.searchQuery;
      if (event.searchUrl) searchUrl = event.searchUrl;

      pushEvent(run, {
        type: event.type,
        data: event.data,
        searchQuery: event.searchQuery,
        messageId: aiMessageId,
        searchUrl,
      });

      sources =
        event.type === 'sources'
          ? deduplicateDocuments(event.data)
          : deduplicateDocuments([...sources, ...event.data]);
      scheduleFlush(true);
    } else if (event.type === 'tool_call_started') {
      pushEvent(run, { ...event, messageId: aiMessageId });
      recievedMessage = appendWidget<ToolCallPayload>(
        recievedMessage,
        'tool_call',
        {
          id: event.data.toolCallId,
          type: event.data.toolType,
          status: event.data.status,
          ...event.data.attrs,
        },
      );
      scheduleFlush(true);
    } else if (event.type === 'tool_call_success') {
      pushEvent(run, { ...event, messageId: aiMessageId });
      recievedMessage = updateWidget<ToolCallPayload>(
        recievedMessage,
        'tool_call',
        event.data.toolCallId,
        { status: event.data.status, ...event.data.extra },
      );
      scheduleFlush(true);
    } else if (event.type === 'tool_call_error') {
      pushEvent(run, { ...event, messageId: aiMessageId });
      recievedMessage = updateWidget<ToolCallPayload>(
        recievedMessage,
        'tool_call',
        event.data.toolCallId,
        { status: event.data.status, error: event.data.error },
      );
      scheduleFlush(true);
    } else if (event.type === 'artifact_saved') {
      pushEvent(run, { ...event, messageId: aiMessageId });
      // Same upsert the client reducer runs, so the persisted copy and the
      // live one carry byte-identical cards.
      recievedMessage = upsertArtifactWidget(recievedMessage, {
        id: event.data.artifactId,
        title: event.data.title,
        version: event.data.version,
        action: event.data.action,
      });
      scheduleFlush(true);
    } else if (
      event.type === 'subagent_started' ||
      event.type === 'subagent_completed' ||
      event.type === 'subagent_error' ||
      event.type === 'subagent_data'
    ) {
      pushEvent(run, { ...event, messageId: aiMessageId } as StreamEvent);

      if (event.type === 'subagent_started') {
        recievedMessage = appendWidget<SubagentPayload>(
          recievedMessage,
          'subagent',
          {
            id: event.executionId,
            name: event.name ?? '',
            task: event.task ?? '',
            status: 'running',
            toolCalls: [],
          },
        );
      } else if (event.type === 'subagent_data') {
        const nestedEvent = event.data;
        const executionId = event.subagentId;
        if (nestedEvent.type === 'response') {
          recievedMessage = updateWidget<SubagentPayload>(
            recievedMessage,
            'subagent',
            executionId,
            (current) => ({
              ...current,
              responseText: stripStreamedChartTags(
                (current.responseText ?? '') +
                  neutralizeSpoofedFences(nestedEvent.data || ''),
              ),
            }),
          );
        } else if (nestedEvent.type === 'tool_call_started') {
          const { toolCallId, toolType, status, attrs } = nestedEvent.data;
          recievedMessage = updateWidget<SubagentPayload>(
            recievedMessage,
            'subagent',
            executionId,
            (current) => ({
              ...current,
              toolCalls: upsertNestedToolCall(current.toolCalls, {
                id: toolCallId,
                type: toolType,
                status,
                ...attrs,
              }),
            }),
          );
        } else if (
          nestedEvent.type === 'tool_call_success' ||
          nestedEvent.type === 'tool_call_error'
        ) {
          const patch: Partial<ToolCallPayload> =
            nestedEvent.type === 'tool_call_error'
              ? {
                  status: nestedEvent.data.status,
                  error: nestedEvent.data.error,
                }
              : { status: nestedEvent.data.status, ...nestedEvent.data.extra };
          recievedMessage = updateWidget<SubagentPayload>(
            recievedMessage,
            'subagent',
            executionId,
            (current) => ({
              ...current,
              toolCalls: patchNestedToolCall(
                current.toolCalls,
                nestedEvent.data.toolCallId,
                patch,
              ),
            }),
          );
        }
      } else {
        const status =
          event.type === 'subagent_completed' ? 'success' : 'error';
        recievedMessage = updateWidget<SubagentPayload>(
          recievedMessage,
          'subagent',
          event.id,
          {
            status,
            summary:
              typeof event.summary === 'string'
                ? stripStreamedChartTags(event.summary)
                : event.summary,
            error: event.error,
          },
        );
      }
      scheduleFlush(true);
    } else if (
      event.type === 'panel_executor_started' ||
      event.type === 'panel_executor_data' ||
      event.type === 'panel_executor_completed' ||
      event.type === 'panel_executor_error'
    ) {
      const panelEvent =
        event.type === 'panel_executor_data'
          ? {
              ...event,
              token: neutralizeSpoofedFences(event.token ?? ''),
            }
          : event;
      pushEvent(run, {
        ...panelEvent,
        messageId: aiMessageId,
      } as StreamEvent);
      const idx = event.executorIdx;
      if (event.type === 'panel_executor_started') {
        recievedMessage = startPanelColumn(
          recievedMessage,
          idx,
          event.model ?? `Model ${idx + 1}`,
        );
      } else if (event.type === 'panel_executor_data') {
        recievedMessage = stripPanelColumnModelTags(
          appendPanelColumnToken(
            recievedMessage,
            idx,
            panelEvent.type === 'panel_executor_data' ? panelEvent.token : '',
          ),
          idx,
        );
      } else if (event.type === 'panel_executor_completed') {
        recievedMessage = setPanelColumnStatus(
          recievedMessage,
          idx,
          'success',
          {
            sourceCount: event.sourceCount,
            tokens: panelExecutorTokens(event.usage),
            model: event.model,
          },
        );
      } else {
        recievedMessage = setPanelColumnStatus(recievedMessage, idx, 'error', {
          error: event.error,
          model: event.model,
        });
      }
      scheduleFlush(true);
    } else if (event.type === 'chart_spec') {
      const { chartId, spec } = event.data;
      const parsed = ChartSpecSchema.safeParse(spec);
      if (!chartId || !parsed.success) return;
      chartSpecs[chartId] = parsed.data;
      pushEvent(run, {
        type: 'chart_spec',
        data: { ...event.data, spec: parsed.data },
        messageId: aiMessageId,
      });
      scheduleFlush(true);
    } else if (event.type === 'chart_placement') {
      const payload = resolveChartPlacement(chartSpecs, event.data);
      if (!payload) return;
      shownChartIds.add(payload.chartId);
      recievedMessage = appendChartWidget(recievedMessage, payload);
      pushEvent(run, {
        type: 'chart_placement',
        data: event.data,
        messageId: aiMessageId,
      });
      scheduleFlush(true);
    } else if (event.type === 'panel_executor_chart') {
      const payload = resolveChartPlacement(chartSpecs, event.data);
      if (!payload) return;
      shownChartIds.add(payload.chartId);
      recievedMessage = appendPanelColumnChart(
        recievedMessage,
        event.executorIdx,
        payload,
      );
      pushEvent(run, {
        type: 'panel_executor_chart',
        executorIdx: event.executorIdx,
        data: event.data,
        messageId: aiMessageId,
      });
      scheduleFlush(true);
    } else if (event.type === 'todo_update') {
      pushEvent(run, {
        type: 'todo_update',
        data: event.data,
        messageId: aiMessageId,
      });
    } else if (event.type === 'code_execution_result') {
      pushEvent(run, {
        type: 'code_execution_result',
        data: event.data,
        messageId: aiMessageId,
      });
      const tcId =
        (event.data.executionId &&
          codeExecutionRunIdMap.get(event.data.executionId)) ||
        event.data.toolCallId;
      if (tcId) {
        const d = event.data;
        const extra: Partial<ToolCallPayload> = {};
        if (d.exitCode !== undefined) extra.exitCode = d.exitCode;
        if (d.stdout) extra.stdout = d.stdout.slice(0, 2000);
        if (d.stderr) extra.stderr = d.stderr.slice(0, 1000);
        if (d.timedOut) extra.timedOut = true;
        if (d.oomKilled) extra.oomKilled = true;
        if (d.denied) extra.denied = true;
        if (Array.isArray(d.chartIds) && d.chartIds.length > 0)
          extra.chartIds = d.chartIds.join(',');
        recievedMessage = updateWidget<ToolCallPayload>(
          recievedMessage,
          'tool_call',
          tcId,
          extra,
        );
      }
      scheduleFlush(true);
    } else if (event.type === 'context_grew') {
      pushEvent(run, {
        type: 'context_grew',
        kind: event.kind,
        tokens: event.tokens,
        totalEstimated: event.totalEstimated,
        messageId: aiMessageId,
      });
    } else if (event.type === 'workspace_file_changed') {
      pushEvent(run, {
        type: 'workspace_file_changed',
        data: event.data,
        messageId: aiMessageId,
      });
    } else if (event.type === 'model_stats') {
      // After messageEnd, still fold late usage (auto-title) into modelStats so
      // terminate persists the true total — but don't push another wire `stats`.
      modelStats = {
        ...event.data,
        usedLocation,
        usedPersonalization,
      };
      if (!messageEnded) {
        pushEvent(run, {
          type: 'stats',
          data: modelStats,
          messageId: aiMessageId,
        });
      }
    } else if (event.type === 'interrupt') {
      try {
        await handleInterrupts(run, event.interrupts);
      } catch (err) {
        console.error('[runHost] handleInterrupts failed:', err);
      }
    } else if (event.type === 'agent_end') {
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
      // The composer has now unblocked (client reducer flips loading off at
      // messageEnd), so the brief auto-title call below is invisible to input.
      messageEnded = true;

      // Auto-title: after the first assistant turn, summarize it into a chat
      // title. Runs before terminate — the only window that still reaches
      // subscribers — so an in-view chat updates live. Its system-model tokens
      // are recorded on the turn tracker; recompute modelStats so the persisted
      // DB row is complete (the already-sent messageEnd undercounts, ephemeral).
      if (titleGen?.autoTitleEnabled) {
        const modelStatsBeforeTitle = isModelStatsV2(modelStats)
          ? modelStats
          : undefined;
        const titleStatsBefore = titleGen.tracker.statsV2();
        await maybeGenerateTitle({
          run,
          chatId,
          aiMessageId,
          answer: recievedMessage,
          ctx: titleGen,
        });
        // The title call uses the original turn tracker even when this agent
        // was reconstructed for a resume. Merge only the title-call delta into
        // the cumulative resume stats instead of replacing them with that
        // tracker's pre-pause snapshot.
        const titleStatsAfter = titleGen.tracker.statsV2();
        modelStats = modelStatsBeforeTitle
          ? addModelStatsDelta(
              modelStatsBeforeTitle,
              titleStatsBefore,
              titleStatsAfter,
            )
          : titleStatsAfter;
        modelStats = {
          ...modelStats,
          responseTime: endTime - startTime,
          usedLocation,
          usedPersonalization,
        };
      }

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
        ...(Object.keys(visibleChartMetadata()).length > 0 && {
          chartSpecs: visibleChartMetadata(),
        }),
        // no runStatus field = success
      });
    } else if (event.type === 'agent_error') {
      pushEvent(run, { type: 'error', data: event.data });

      deleteCheckpoint(run.threadId).catch(console.warn);
      terminate('errored', {
        createdAt: new Date(),
        runStatus: 'errored',
        ...(sources.length > 0 && { sources }),
        ...(searchQuery && { searchQuery }),
        ...(searchUrl && { searchUrl }),
        ...(Object.keys(visibleChartMetadata()).length > 0 && {
          chartSpecs: visibleChartMetadata(),
        }),
      }).catch(console.warn);
    }
  });
}

/**
 * Attach event listeners to a lazily-reconstructed awaiting_user run.
 * Delegates to attachRunHost with isResume:true, which skips DB init and
 * seeds recievedMessage + markup-correlation maps from the existing run state.
 */
export async function attachResumedRunHost(run: Run): Promise<void> {
  const priorStats = latestModelStatsV2(run.eventLog);
  return attachRunHost({
    run,
    userMessageId: run.messageId,
    startTime: run.startedAt,
    usedLocation: priorStats?.usedLocation ?? false,
    usedPersonalization: priorStats?.usedPersonalization ?? false,
    memoriesUsed: [],
    configSnapshot: null,
    isResume: true,
  });
}
