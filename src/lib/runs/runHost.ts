import {
  appendWidget,
  updateWidget,
  upsertNestedToolCall,
  patchNestedToolCall,
  startPanelColumn,
  appendPanelColumnToken,
  setPanelColumnStatus,
  appendChartWidget,
  appendMapWidget,
  appendPanelColumnChart,
  neutralizeSpoofedFences,
  consumeSpoofedFenceChunk,
  flushSpoofedFenceChunk,
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
  restoreTurnMapRegistryFromMilestones,
  resolveTurnMapPlacement,
  TurnMapRegistry,
} from '@/lib/maps/turnMapRegistry';
import {
  MapSessionOverlaySchema,
  MapSpecSchema,
  PersistableMapSpecSchema,
  toPersistableMapSpec,
  type PersistableMapSpec,
  type MapSpec,
} from '@/lib/maps/types';
import { mapSpecToPayload } from '@/lib/maps/presentation';
import {
  createMappingRunRuntime,
  mappingConfigurationFingerprint,
  resolveFreshMappingService,
} from '@/lib/maps/runtime';
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
  sanitizeLocationMilestone,
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
import {
  LocationApprovalPayloadSchema,
  LocationApprovalResponseSchema,
  LocationTokenResumeResponseSchema,
  clearLocationTokensForRun,
  getLocationSession,
  isLocationApprovalExpired,
  isLocationApprovalWindowBounded,
  locationHostsMatch,
  type LocationApprovalResponse,
  type LocationPurpose,
  type LocationRetention,
  type LocationSession,
  type LocationTokenResumeResponse,
} from '@/lib/maps/locationSessions';
import {
  mappingLocationHosts,
  type MappingConfiguration,
} from '@/lib/maps/config';
import { getMappingConfiguration } from '@/lib/settings/server';

// ── Types ──────────────────────────────────────────────────────────────────

// In-memory lock to prevent concurrent resumes for the same approvalId
const resumeLocks = new Set<string>();

type LocationApprovalTimer = {
  messageId: string;
  timer: ReturnType<typeof setTimeout>;
};

// Location prompts must expire even when the approving page closes before its
// client-side timer runs. The timer stores only an approval/message identity;
// the disclosure payload and any coordinate stay out of this process-local
// scheduler state.
const locationApprovalTimers = new Map<string, LocationApprovalTimer>();

function clearLocationApprovalTimer(approvalId: string): void {
  const entry = locationApprovalTimers.get(approvalId);
  if (!entry) return;
  clearTimeout(entry.timer);
  locationApprovalTimers.delete(approvalId);
}

function clearLocationApprovalTimersForMessage(messageId: string): void {
  for (const [approvalId, entry] of locationApprovalTimers) {
    if (entry.messageId === messageId) clearLocationApprovalTimer(approvalId);
  }
}

function scheduleLocationApprovalExpiry(
  approvalId: string,
  messageId: string,
  expiresAt: number,
): void {
  clearLocationApprovalTimer(approvalId);
  const delay = Math.max(1, expiresAt - Date.now());
  const timer = setTimeout(() => {
    locationApprovalTimers.delete(approvalId);
    void expireLocationApproval(approvalId).catch(() => undefined);
  }, delay);
  locationApprovalTimers.set(approvalId, { messageId, timer });
  const unref = (timer as unknown as { unref?: () => void }).unref;
  if (unref) unref.call(timer);
}

// Persist milestone events for cross-restart reconstruction. Registered once.
setEventPersister((run, seqEvent) => {
  enqueueRunEvent(run.messageId, run.chatId, seqEvent, {
    retainRoute:
      run.locationRetention !== 'once' &&
      (run.locationRetention === 'save' || run.locationToken === undefined),
    retainOrigin:
      run.locationRetention !== 'once' &&
      (run.locationRetention === 'save' || run.locationToken === undefined),
  });
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

/** Remove any precise data from legacy or tampered location rows. */
async function scrubLocationApprovalRows(messageId: string): Promise<void> {
  await db
    .update(approvalRequests)
    .set({ payload: {}, snapshot: null, response: null })
    .where(
      and(
        eq(approvalRequests.messageId, messageId),
        eq(approvalRequests.toolKind, 'location'),
      ),
    )
    .execute();
}

/** Mark all open approvals for a message as interrupted (server restart). */
export async function markOpenApprovalsInterrupted(
  messageId: string,
): Promise<void> {
  clearLocationTokensForRun(messageId);
  await markOpenApprovals(messageId, 'interrupted');
  await scrubLocationApprovalRows(messageId);
  clearLocationApprovalTimersForMessage(messageId);
}

/** Mark all open approvals for a message as cancelled. */
export async function markOpenApprovalsCancelled(
  messageId: string,
): Promise<void> {
  clearLocationTokensForRun(messageId);
  await markOpenApprovals(messageId, 'cancelled');
  await scrubLocationApprovalRows(messageId);
  clearLocationApprovalTimersForMessage(messageId);
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

/** Re-arm location approval expiry after an application restart. */
export async function schedulePendingLocationApprovalExpiries(): Promise<void> {
  const rows = await db
    .select({
      id: approvalRequests.id,
      messageId: approvalRequests.messageId,
      payload: approvalRequests.payload,
      snapshot: approvalRequests.snapshot,
      response: approvalRequests.response,
    })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.toolKind, 'location'),
        isNull(approvalRequests.resolvedAt),
      ),
    );
  for (const row of rows) {
    const staleReason =
      row.snapshot != null || row.response != null
        ? 'Location approval contains invalid durable data.'
        : 'Location approval data is invalid; ask for a named origin instead.';
    const payload = sanitizeLocationApprovalPayload(row.payload);
    if (row.snapshot != null || row.response != null || !payload) {
      await resumeLocationApprovalStale(row.id, staleReason).catch(() =>
        markLocationApprovalStale(row.id, staleReason),
      );
      continue;
    }
    if (isLocationApprovalExpired(payload)) {
      await expireLocationApproval(row.id).catch(() => undefined);
      continue;
    }
    scheduleLocationApprovalExpiry(row.id, row.messageId, payload.expiresAt);
  }
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

export function sanitizeLocationApprovalPayload(
  value: unknown,
): import('@/lib/maps/locationSessions').LocationApprovalPayload | null {
  const parsed = LocationApprovalPayloadSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    parsed.data.expiresAt <= parsed.data.createdAt ||
    parsed.data.expiresAt - parsed.data.createdAt > 10 * 60 * 1000 ||
    !isLocationApprovalWindowBounded(parsed.data)
  ) {
    return null;
  }
  return parsed.data;
}

function isSafeLocationIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f<>]/.test(value)
  );
}

async function handleInterrupts(
  run: Run,
  interrupts: LangGraphInterrupt[],
): Promise<void> {
  for (const i of interrupts) {
    const { kind, toolCallId, markupKey, payload, snapshot } = i.value;
    if (
      kind === 'location' &&
      (!isSafeLocationIdentifier(i.id) || !isSafeLocationIdentifier(toolCallId))
    ) {
      throw new Error('Invalid location approval identity');
    }
    const safePayload =
      kind === 'location' ? sanitizeLocationApprovalPayload(payload) : payload;
    if (kind === 'location' && !safePayload) {
      throw new Error('Invalid location approval payload');
    }
    if (kind === 'location') {
      const locationPayload =
        safePayload as import('@/lib/maps/locationSessions').LocationApprovalPayload;
      if (locationPayload.aiMessageId !== run.aiMessageId) {
        throw new Error(
          'Location approval assistant identity does not match the run',
        );
      }
      if (
        !run.clientSessionId ||
        run.clientSessionId !== locationPayload.clientSessionId
      ) {
        throw new Error(
          'Location approval page session does not match the run',
        );
      }
      if (!run.mappingConfig?.available) {
        throw new Error('Location approval mapping configuration is stale');
      }
      const currentHosts = mappingLocationHosts(run.mappingConfig);
      if (
        mappingConfigurationFingerprint(run.mappingConfig) !==
          locationPayload.configHash ||
        !locationHostsMatch(locationPayload.authorizedHosts, currentHosts)
      ) {
        throw new Error('Location approval mapping configuration is stale');
      }
    }

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
        payload: safePayload,
        // Location interrupts carry no external snapshot. In particular, do
        // not trust a producer-supplied snapshot at this boundary because it
        // could retain precise browser data in the approval row.
        snapshot: kind === 'location' ? null : (snapshot ?? null),
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .execute();

    // Already seen (e.g. re-detected after a partial parallel resume): the
    // *_pending event was emitted on first observation, so don't duplicate it.
    if ((insert as unknown as { changes?: number })?.changes === 0) continue;

    if (kind === 'location') {
      const locationPayload = safePayload as {
        expiresAt: number;
      };
      scheduleLocationApprovalExpiry(
        i.id,
        run.messageId,
        locationPayload.expiresAt,
      );
    }

    const markupToolCallId = resolveMarkupToolCallId(kind, markupKey);

    // pushEvent enqueues the *_pending event via the registered persister.
    pushEvent(run, {
      type: `${kind}_pending`,
      data: {
        approvalId: i.id,
        toolCallId,
        markupToolCallId,
        ...(safePayload as Record<string, unknown>),
      },
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

function mappingRuntimeForConfig(config: AgentRunConfig) {
  const runtime = createMappingRunRuntime(
    config.interactiveSession &&
      config.focusMode === 'webSearch' &&
      config.panel === null &&
      config.mappingAvailable === true,
  );
  if (
    runtime.service &&
    config.mappingConfigHash &&
    runtime.config &&
    mappingConfigurationFingerprint(runtime.config) !== config.mappingConfigHash
  ) {
    return { ...runtime, service: null };
  }
  return runtime;
}

/** Resolve the opaque location token for this run without storing its coordinate. */
function locationSessionForRun(
  run: Run,
  purpose?: LocationPurpose,
): LocationSession | null {
  if (!run.locationToken || !run.clientSessionId) return null;
  const session = getLocationSession(run.locationToken, {
    binding: {
      runId: run.threadId,
      chatId: run.chatId,
      messageId: run.messageId,
      aiMessageId: run.aiMessageId,
      clientSessionId: run.clientSessionId,
      ...(run.locationApprovalId ? { approvalId: run.locationApprovalId } : {}),
    },
    ...(purpose ? { purpose } : {}),
  });
  if (!session) return null;
  if (run.locationRetention && session.retention !== run.locationRetention) {
    return null;
  }
  const config = run.mappingConfig;
  if (!config || !config.available) return null;
  const hosts = mappingLocationHosts(config);
  if (
    session.configHash !== mappingConfigurationFingerprint(config) ||
    !locationHostsMatch(session.authorizedHosts, hosts)
  ) {
    return null;
  }
  // Re-check the live configuration at the sensitive delivery boundary. A
  // setting change after a provider call must not allow its exact result to
  // reach the page or extend the old approval's authorization.
  try {
    const current = getMappingConfiguration();
    if (
      !current.available ||
      mappingConfigurationFingerprint(current) !== session.configHash ||
      !locationHostsMatch(
        session.authorizedHosts,
        mappingLocationHosts(current),
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return session;
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
  if (toolKind === 'mcp_tool' || toolKind === 'location') {
    return (
      (response as { approved?: boolean } | null | undefined)?.approved ===
      false
    );
  }
  return false;
}

const LOCATION_STALE_RESUME = Symbol('yaawc-location-stale-resume');

type LocationStaleResume = {
  [LOCATION_STALE_RESUME]: true;
  reason: string;
};

type PreparedLocationResume = {
  engineResponse: LocationTokenResumeResponse | LocationApprovalResponse;
  storedResponse: LocationApprovalResponse;
  staleReason?: string;
  /** Only the opaque token crosses into the resumed graph context. */
  locationToken?: string;
  locationRetention?: LocationRetention;
};

function isLocationStaleResume(value: unknown): value is LocationStaleResume {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Partial<LocationStaleResume>)[LOCATION_STALE_RESUME] === true &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

function safeLocationStaleReason(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized.includes('expir')) {
    return 'Location approval expired; ask for a named origin instead.';
  }
  if (normalized.includes('config') || normalized.includes('host')) {
    return 'Mapping configuration changed; ask for a named origin instead.';
  }
  return 'Location approval is no longer valid; ask for a named origin instead.';
}

function currentLocationHosts(config: MappingConfiguration): string[] {
  return mappingLocationHosts(config);
}

/** Validate a location resume without ever returning the browser coordinate. */
function prepareLocationResume(params: {
  approval: typeof approvalRequests.$inferSelect;
  response: unknown;
  run: Run;
  runConfig: AgentRunConfig;
}): PreparedLocationResume {
  const { approval, response, run, runConfig } = params;
  const staleResume = isLocationStaleResume(response);
  const hasForbiddenDurableData =
    approval.snapshot != null || approval.response != null;
  const payload = sanitizeLocationApprovalPayload(approval.payload);
  if (hasForbiddenDurableData || !payload) {
    if (!staleResume) {
      throw new StaleSnapshotError(
        'This location approval is invalid or has expired; ask for a named origin instead.',
      );
    }
    // A malformed persisted prompt cannot provide a page binding, but the
    // internal stale marker is still a coordinate-free, safe way to unblock
    // its checkpoint. Do not leave the run paused behind an unusable row.
    const staleReason = safeLocationStaleReason(response.reason);
    const reason = staleReason.includes('expired')
      ? ('expired' as const)
      : ('unavailable' as const);
    return {
      engineResponse: { approved: false, retention: 'once', reason },
      storedResponse: { approved: false, retention: 'once', reason },
      staleReason,
    };
  }
  if (
    payload.aiMessageId !== runConfig.aiMessageId ||
    approval.chatId !== run.chatId ||
    approval.threadId !== run.threadId ||
    approval.messageId !== run.messageId ||
    run.clientSessionId !== payload.clientSessionId
  ) {
    throw new StaleSnapshotError(
      'This location approval no longer belongs to the active page session; ask for a named origin instead.',
    );
  }

  if (staleResume) {
    const staleReason = safeLocationStaleReason(response.reason);
    const declined: LocationApprovalResponse = {
      approved: false,
      retention: 'once',
      reason: staleReason.includes('expired') ? 'expired' : 'unavailable',
      clientSessionId: payload.clientSessionId,
    };
    return {
      engineResponse: declined,
      storedResponse: {
        approved: false,
        retention: 'once',
        reason: declined.reason,
      },
      staleReason,
    };
  }

  const tokenResponse = LocationTokenResumeResponseSchema.safeParse(response);
  if (!tokenResponse.success) {
    const declined = LocationApprovalResponseSchema.safeParse(response);
    if (
      !declined.success ||
      declined.data.approved ||
      declined.data.clientSessionId !== payload.clientSessionId
    ) {
      throw new StaleSnapshotError(
        'The location approval response was invalid or belongs to another page session; ask for a named origin instead.',
      );
    }
    const storedResponse: LocationApprovalResponse = {
      approved: false,
      retention: 'once',
      ...(declined.data.reason ? { reason: declined.data.reason } : {}),
    };
    // A denial contains no precise data, so it remains safe to use to close an
    // approval that expired while the browser prompt was open.
    return { engineResponse: storedResponse, storedResponse };
  }

  if (isLocationApprovalExpired(payload)) {
    throw new StaleSnapshotError(
      'This location approval has expired; ask for a named origin instead.',
    );
  }

  if (
    tokenResponse.data.clientSessionId !== payload.clientSessionId ||
    tokenResponse.data.clientSessionId !== run.clientSessionId
  ) {
    throw new StaleSnapshotError(
      'This location approval belongs to another page session; ask for a named origin instead.',
    );
  }
  if (
    !runConfig.interactiveSession ||
    runConfig.focusMode !== 'webSearch' ||
    runConfig.panel !== null ||
    runConfig.mappingAvailable !== true ||
    !runConfig.mappingConfigHash ||
    runConfig.mappingConfigHash !== payload.configHash
  ) {
    throw new StaleSnapshotError(
      'This location approval is not valid for an interactive mapping turn; ask for a named origin instead.',
    );
  }

  if (runConfig.isPrivate && tokenResponse.data.retention === 'save') {
    throw new StaleSnapshotError(
      'Saving a precise route is unavailable in a private chat.',
    );
  }
  if (!payload.allowSave && tokenResponse.data.retention === 'save') {
    throw new StaleSnapshotError(
      'This location approval does not allow saving the route in the answer.',
    );
  }
  let config: MappingConfiguration;
  try {
    config = getMappingConfiguration();
  } catch {
    throw new StaleSnapshotError(
      'Mapping configuration is unavailable; ask for a named origin instead.',
    );
  }
  if (
    !config.available ||
    mappingConfigurationFingerprint(config) !== payload.configHash ||
    (runConfig.mappingConfigHash !== undefined &&
      mappingConfigurationFingerprint(config) !==
        runConfig.mappingConfigHash) ||
    !locationHostsMatch(payload.authorizedHosts, currentLocationHosts(config))
  ) {
    throw new StaleSnapshotError(
      'Mapping configuration changed while location approval was pending; ask for a named origin instead.',
    );
  }

  const session = getLocationSession(tokenResponse.data.locationToken, {
    binding: {
      approvalId: approval.id,
      runId: approval.threadId,
      chatId: approval.chatId,
      messageId: approval.messageId,
      aiMessageId: payload.aiMessageId,
      clientSessionId: tokenResponse.data.clientSessionId,
    },
    authorizedHosts: currentLocationHosts(config),
    configHash: payload.configHash,
  });
  if (!session || session.retention !== tokenResponse.data.retention) {
    throw new StaleSnapshotError(
      'This location approval token is expired or belongs to another page session.',
    );
  }
  const storedResponse: LocationApprovalResponse = {
    approved: true,
    retention: tokenResponse.data.retention,
  };
  return {
    engineResponse: tokenResponse.data,
    storedResponse,
    locationToken: session.token,
    locationRetention: tokenResponse.data.retention,
  };
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

/** Close a pending location approval when its browser/config snapshot expires. */
export async function markLocationApprovalStale(
  approvalId: string,
  reason: string,
): Promise<void> {
  const approval = await db.query.approvalRequests.findFirst({
    where: eq(approvalRequests.id, approvalId),
  });
  if (!approval || approval.toolKind !== 'location' || approval.resolvedAt) {
    return;
  }
  const staleReason = safeLocationStaleReason(reason);
  const safeResponse: LocationApprovalResponse = {
    approved: false,
    retention: 'once',
    reason: staleReason.includes('expired') ? 'expired' : 'unavailable',
  };
  const safePayload = sanitizeLocationApprovalPayload(approval.payload);
  const result = await db
    .update(approvalRequests)
    .set({
      payload: safePayload ?? {},
      snapshot: null,
      resolvedAt: Date.now(),
      resolutionKind: 'stale_snapshot',
      response: safeResponse,
    })
    .where(
      and(
        eq(approvalRequests.id, approvalId),
        isNull(approvalRequests.resolvedAt),
      ),
    )
    .execute();
  if ((result as unknown as { changes?: number })?.changes === 0) {
    clearLocationApprovalTimer(approvalId);
    return;
  }
  clearLocationApprovalTimer(approvalId);
  clearLocationTokensForRun(approval.messageId);
  const { getRun } = await import('./runHub');
  const run = getRun(approval.messageId);
  if (run) {
    // Keep a transient retention marker so a late provider event is still
    // redacted even after the token itself has expired or been revoked.
    run.locationToken = undefined;
    run.locationApprovalId = undefined;
    emitStaleAndMarkup(run, approval, staleReason);
  }
}

/** Resume a stale location approval with an opaque, coordinate-free denial. */
export async function resumeLocationApprovalStale(
  approvalId: string,
  reason: string,
): Promise<void> {
  await performResume([
    {
      approvalId,
      response: {
        [LOCATION_STALE_RESUME]: true,
        reason: safeLocationStaleReason(reason),
      } satisfies LocationStaleResume,
    },
  ]);
}

/**
 * Close an expired location prompt without requiring a browser response. A
 * denial is safe to pass through the checkpoint because it carries no token or
 * coordinate; the fallback marks the approval stale if the run is no longer
 * resumable.
 */
export async function expireLocationApproval(
  approvalId: string,
): Promise<boolean> {
  const approval = await db.query.approvalRequests.findFirst({
    where: eq(approvalRequests.id, approvalId),
  });
  if (!approval || approval.toolKind !== 'location' || approval.resolvedAt) {
    return false;
  }
  const payload = sanitizeLocationApprovalPayload(approval.payload);
  if (!payload || !isLocationApprovalExpired(payload)) return false;

  try {
    await resumeRun(approvalId, {
      approved: false,
      retention: 'once',
      reason: 'expired',
      clientSessionId: payload.clientSessionId,
    });
  } catch {
    await markLocationApprovalStale(
      approvalId,
      'Location approval expired; ask for a named origin instead.',
    ).catch(() => undefined);
  }
  return true;
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
    const responseById = new Map(items.map((i) => [i.approvalId, i.response]));
    const preparedLocations = new Map<string, PreparedLocationResume>();
    const staleReasons = new Map<string, string>();
    for (const approval of approvals.values()) {
      if (approval.toolKind !== 'location') continue;
      const prepared = prepareLocationResume({
        approval,
        response: responseById.get(approval.id),
        run,
        runConfig,
      });
      preparedLocations.set(approval.id, prepared);
      if (prepared.staleReason) {
        staleReasons.set(approval.id, prepared.staleReason);
      }
    }

    // Stale-state guard for each approval. If external state changed while paused
    // (file sha / skill content), the approved preview can't be applied verbatim —
    // but rather than killing the whole run, convert that approval into a synthetic
    // "stale" rejection. The resumed tool recognizes it and returns an informative
    // error, so the agent can re-read and retry on its own. Rejections skip the
    // check: a rejected edit is never applied, so underlying changes don't matter.
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

    const storedResponseFor = (approvalId: string, response: unknown) =>
      preparedLocations.get(approvalId)?.storedResponse ?? response;
    const engineResponseFor = (approvalId: string, response: unknown) =>
      preparedLocations.get(approvalId)?.engineResponse ?? response;

    // Mark each resolved (first-write-wins via WHERE resolvedAt IS NULL). A
    // location token is deliberately replaced by its coordinate-free choice
    // before the approval row is written.
    for (const { approvalId, response } of effectiveItems) {
      const approval = approvals.get(approvalId)!;
      const result = await db
        .update(approvalRequests)
        .set({
          ...(approval.toolKind === 'location'
            ? {
                payload:
                  sanitizeLocationApprovalPayload(approval.payload) ?? {},
                snapshot: null,
              }
            : {}),
          resolvedAt: Date.now(),
          response: storedResponseFor(approvalId, response),
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
      clearLocationApprovalTimer(approvalId);
    }

    for (const prepared of preparedLocations.values()) {
      if (prepared.locationToken) {
        // Keep only the opaque bearer in the run and graph context. The token
        // store remains the sole owner of the precise coordinate.
        run.locationToken = prepared.locationToken;
        run.locationRetention = prepared.locationRetention;
      }
    }
    for (const [approvalId, prepared] of preparedLocations) {
      if (!prepared.locationToken) continue;
      run.locationApprovalId = approvalId;
      const approval = approvals.get(approvalId);
      const payload = approval
        ? sanitizeLocationApprovalPayload(approval.payload)
        : null;
      if (payload) run.clientSessionId = payload.clientSessionId;
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
      else
        emitAnsweredAndMarkup(
          run,
          approval,
          storedResponseFor(approvalId, response),
        );
    }

    const { createTurnTracker } = await import('@/lib/tokens/tracker');
    const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
      run.emitter,
      runConfig.chatModelRef,
      runConfig.systemModelRef,
    );
    const prePauseStats = latestModelStatsV2(run.eventLog);
    if (prePauseStats) tracker.seed(prePauseStats);

    // Re-resolve the provider facade on resume. A paused run keeps its
    // capability snapshot, but current settings decide whether a call may run.
    const mappingRuntime = mappingRuntimeForConfig(runConfig);
    run.mappingConfig = mappingRuntime.config;
    run.mappingService = mappingRuntime.service;

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
        mapRegistry: run.mapRegistry,
        mappingConfig: run.mappingConfig,
        mappingService: run.mappingService,
        mappingServiceResolver: () =>
          resolveFreshMappingService(
            runConfig.mappingAvailable === true,
            runConfig.mappingConfigHash,
          ),
        mappingSavedLocationEnabled:
          runConfig.mappingSavedLocationEnabled === true,
        locationToken: run.locationToken,
        locationApprovalId: run.locationApprovalId,
        clientSessionId: run.clientSessionId,
      },
    });
    // Single pending interrupt → bare value; multiple → map keyed by the
    // engine interrupt id so LangGraph routes each value to the right interrupt.
    let resumeArg: unknown;
    if (useKeyedMap) {
      const map: Record<string, unknown> = {};
      for (const { approvalId, response } of effectiveItems) {
        const a = approvals.get(approvalId)!;
        map[a.engineInterruptId ?? a.id] = engineResponseFor(
          approvalId,
          response,
        );
      }
      resumeArg = map;
    } else {
      resumeArg = engineResponseFor(
        effectiveItems[0].approvalId,
        effectiveItems[0].response,
      );
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
    const includesLocationResume = effectiveItems.some(
      (item) => approvals.get(item.approvalId)?.toolKind === 'location',
    );
    handler
      .doResume({
        resumeArg,
        pinnedMcpDescriptors,
        mcpMarkupIds,
        existingDocuments,
      })
      .catch((err: unknown) => {
        // Location resume state contains a bearer token. Keep both logs and
        // the client-facing failure coordinate/token-free even if an engine
        // error happens to stringify its resume input.
        const safeError = includesLocationResume
          ? 'The approved location could not be used; ask for a named origin instead.'
          : String(err);
        if (includesLocationResume) {
          console.error('[resumeRun] doResume failed for location approval');
        } else {
          console.error('[resumeRun] doResume error:', err);
        }
        // Without this the run stays `running` forever on a doResume failure
        // (no `end`/`error` event ⇒ terminate() never fires). Emit `error` on
        // the run emitter so the run transitions to `errored` and clients stop
        // spinning. The handler's `terminated` guard makes this a no-op if the
        // run already completed.
        try {
          emitStreamEvent(resumedRun.emitter, {
            type: 'agent_error',
            data: safeError,
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
  const eventLog = persistedEvents.flatMap((e) => {
    // Persisted rows may use pre-canonical approval type names; normalize so
    // resume seeding and replay match the current vocabulary.
    const normalized = normalizeStreamEvent(e.data) as StreamEvent;
    const eventType = (normalized as { type?: unknown }).type;
    if (typeof eventType !== 'string') return [];
    // A legacy/tampered database row must not resurrect a precise live-only
    // overlay. New overlays are ineligible for persistence, but fail closed on
    // read as well.
    if (eventType === 'map_session_overlay') return [];
    if (eventType.startsWith('location_')) {
      const safe = sanitizeLocationMilestone(normalized);
      if (!safe) return [];
      return [{ seq: e.seq, ev: safe }];
    }
    return [{ seq: e.seq, ev: normalized }];
  });
  const chartRegistry = new TurnChartRegistry();
  restoreTurnChartRegistryFromMilestones(
    chartRegistry,
    eventLog.map(({ ev }) => ev),
  );
  const mapRegistry = new TurnMapRegistry();
  restoreTurnMapRegistryFromMilestones(
    mapRegistry,
    eventLog.map(({ ev }) => ev),
  );
  const mappingRuntime = mappingRuntimeForConfig(runConfig);
  let clientSessionId: string | undefined;
  for (const { ev } of eventLog) {
    if (ev.type !== 'location_pending') continue;
    const candidate = (ev.data as Record<string, unknown>).clientSessionId;
    if (typeof candidate === 'string' && candidate.length > 0) {
      clientSessionId = candidate;
      break;
    }
  }
  // The approval row is a second coordinate-free source of the page binding.
  // Use it when a transient persistence failure dropped the pending milestone;
  // never reconstruct the binding from a token or a browser payload.
  if (!clientSessionId) {
    const pendingApprovals = await getPendingApprovalsForMessage(messageId);
    for (const approval of pendingApprovals) {
      if (approval.toolKind !== 'location') continue;
      const payload = sanitizeLocationApprovalPayload(approval.payload);
      if (payload) {
        clientSessionId = payload.clientSessionId;
        break;
      }
    }
  }

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
    mapRegistry,
    mappingConfig: mappingRuntime.config,
    mappingService: mappingRuntime.service,
    clientSessionId,
    sessionOverlays: new Map(),
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
  let effectiveUsedLocation =
    usedLocation || Boolean(run.locationToken || run.locationRetention);

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
  let pendingResponseFence = '';
  if (isResume) {
    const milestones = run.eventLog.map(({ ev }) => ev);
    restoreTurnChartRegistryFromMilestones(run.chartRegistry, milestones);
    restoreTurnMapRegistryFromMilestones(run.mapRegistry, milestones);
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

  const mapSpecs: Record<string, PersistableMapSpec> = Object.create(null);
  const handledMapPlacementIds = new Set<string>();
  const shownMapIds = new Set<string>();
  for (const { ev } of run.eventLog) {
    if (ev.type === 'map_spec') {
      const parsed = PersistableMapSpecSchema.safeParse(ev.data.spec);
      if (typeof ev.data.mapId === 'string' && parsed.success) {
        mapSpecs[ev.data.mapId] = parsed.data;
      }
    } else if (ev.type === 'map_placement') {
      if (
        typeof ev.data.mapId === 'string' &&
        typeof ev.data.placementId === 'string' &&
        mapSpecs[ev.data.mapId] &&
        run.mapRegistry.isPlacementAccepted(ev.data.placementId)
      ) {
        handledMapPlacementIds.add(ev.data.placementId);
        shownMapIds.add(ev.data.mapId);
      }
    }
  }
  const visibleMapMetadata = (): Record<string, PersistableMapSpec> => {
    const visible: Record<string, PersistableMapSpec> = Object.create(null);
    for (const mapId of shownMapIds) {
      const spec = mapSpecs[mapId];
      if (spec) visible[mapId] = spec;
    }
    return visible;
  };

  const persistableSpecForRun = (
    value: MapSpec | PersistableMapSpec,
  ): PersistableMapSpec => {
    const parsed = MapSpecSchema.safeParse(value);
    if (!parsed.success) return toPersistableMapSpec(value);

    // A transient location must never be retained in any route from this
    // answer, even if its token expires or a provider returns unexpected
    // endpoints between the call and this writer event. The run itself stores
    // no precise coordinate.
    const transientLocation =
      run.locationRetention === 'once' ||
      (run.locationToken !== undefined && run.locationRetention !== 'save');
    if (transientLocation && (parsed.data.route || parsed.data.origin)) {
      return toPersistableMapSpec(parsed.data, {
        retainRoute: false,
        retainOrigin: false,
      });
    }
    return toPersistableMapSpec(parsed.data);
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
      } else if (ev.type === 'map_placement') {
        if (
          typeof ev.data.placementId !== 'string' ||
          !run.mapRegistry.isPlacementAccepted(ev.data.placementId)
        )
          continue;
        const placement = resolveTurnMapPlacement(run.mapRegistry, ev.data);
        if (!placement) continue;
        const spec = mapSpecs[placement.mapId];
        if (!spec) continue;
        const payload = mapSpecToPayload(
          placement.mapId,
          placement.placementId,
          spec,
        );
        recievedMessage = appendMapWidget(recievedMessage, payload);
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
        ...(Object.keys(visibleMapMetadata()).length > 0 && {
          mapSpecs: visibleMapMetadata(),
        }),
      },
    }).catch((err: unknown) =>
      console.warn('[runHost] incremental flush failed:', err),
    );
  };

  const flushPendingResponseFence = (moreTextMayFollow: boolean) => {
    if (!pendingResponseFence) return;
    const data = flushSpoofedFenceChunk(
      pendingResponseFence,
      moreTextMayFollow,
    );
    pendingResponseFence = '';
    if (!data) return;
    recievedMessage = stripStreamedChartTags(recievedMessage + data);
    pushEvent(run, {
      type: 'response',
      data,
      messageId: aiMessageId,
    });
    scheduleFlush(false);
  };

  const terminate = async (
    status: 'completed' | 'errored' | 'cancelled',
    finalMetadata: Record<string, unknown>,
  ) => {
    if (terminated) return;
    flushPendingResponseFence(false);
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
    clearLocationApprovalTimersForMessage(userMessageId);
    clearLocationTokensForRun(userMessageId);
    clearLocationTokensForRun(run.threadId);
    run.locationToken = undefined;
    run.locationApprovalId = undefined;
    run.locationRetention = undefined;
    // Provider facades are not needed for replay and must not outlive the run.
    run.mappingService = null;
    run.mappingConfig = null;
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
        ...(Object.keys(visibleMapMetadata()).length > 0 && {
          mapSpecs: visibleMapMetadata(),
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
    if (run.locationToken || run.locationRetention) {
      effectiveUsedLocation = true;
    }
    if (event.type !== 'response') {
      flushPendingResponseFence(
        event.type !== 'agent_end' && event.type !== 'agent_error',
      );
    }

    if (event.type === 'response') {
      // Hold a possible partial reserved-fence prefix until the next model
      // chunk. This keeps split `yaawc:` openings out of both the wire and the
      // persisted assistant content.
      const consumed = consumeSpoofedFenceChunk(
        pendingResponseFence,
        event.data,
      );
      pendingResponseFence = consumed.pending;
      const data = consumed.text;
      if (data) {
        pushEvent(run, {
          type: 'response',
          data,
          messageId: aiMessageId,
        });
        recievedMessage = stripStreamedChartTags(recievedMessage + data);
        scheduleFlush(false);
      }
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
      const safeError =
        run.locationToken || run.locationRetention
          ? 'The approved location could not be used; ask for a named origin instead.'
          : event.data.error;
      pushEvent(run, {
        type: 'tool_call_error',
        data: { ...event.data, error: safeError },
        messageId: aiMessageId,
      });
      recievedMessage = updateWidget<ToolCallPayload>(
        recievedMessage,
        'tool_call',
        event.data.toolCallId,
        { status: event.data.status, error: safeError },
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
    } else if (event.type === 'map_spec') {
      const { mapId, spec } = event.data;
      const full = MapSpecSchema.safeParse(spec);
      const persistable = PersistableMapSpecSchema.safeParse(spec);
      const parsed = full.success
        ? full.data
        : persistable.success
          ? persistable.data
          : null;
      const requestedHandle = event.data.handle ?? event.data.turnHandle;
      if (
        typeof mapId !== 'string' ||
        !mapId ||
        (requestedHandle !== undefined &&
          (typeof requestedHandle !== 'string' ||
            !/^map_[1-9]\d*$/.test(requestedHandle))) ||
        (event.data.handle !== undefined &&
          event.data.turnHandle !== undefined &&
          event.data.handle !== event.data.turnHandle) ||
        !parsed ||
        mapSpecs[mapId]
      )
        return;
      let registration =
        typeof requestedHandle === 'string'
          ? run.mapRegistry.resolve(requestedHandle)
          : run.mapRegistry.resolveById(mapId);
      // A provider normally registers before emitting its milestone. Admit a
      // valid event-backed registration as well so an event that crosses an
      // async boundary cannot be lost before the writer sees it.
      if (!registration && typeof requestedHandle === 'string') {
        try {
          registration = run.mapRegistry.registerKnown({
            handle: requestedHandle,
            mapId,
            spec: parsed,
          });
        } catch {
          return;
        }
      }
      if (!registration || registration.mapId !== mapId) return;
      const handle = registration.handle;
      // The registry is the trusted registration boundary. Do not let an
      // event carrying a known handle replace its canonical provider snapshot.
      const safeSpec = persistableSpecForRun(registration.spec);
      mapSpecs[mapId] = safeSpec;
      const source =
        typeof event.data.source === 'string' &&
        event.data.source.length > 0 &&
        event.data.source.length <= 240 &&
        !/[\u0000-\u001f\u007f<>]/.test(event.data.source)
          ? event.data.source
          : undefined;
      pushEvent(run, {
        type: 'map_spec',
        data: {
          mapId,
          handle,
          spec: safeSpec,
          ...(source ? { source } : {}),
        },
        messageId: aiMessageId,
      });
      scheduleFlush(true);
    } else if (event.type === 'map_placement') {
      const placementId = event.data.placementId;
      if (
        typeof placementId !== 'string' ||
        handledMapPlacementIds.has(placementId) ||
        !mapSpecs[event.data.mapId]
      )
        return;
      const placement = resolveTurnMapPlacement(run.mapRegistry, event.data);
      if (!placement) return;
      const spec = mapSpecs[placement.mapId];
      const safeSpec = PersistableMapSpecSchema.safeParse(spec);
      if (!safeSpec.success) return;
      const payload = mapSpecToPayload(
        placement.mapId,
        placement.placementId,
        safeSpec.data,
      );
      const nextMessage = appendMapWidget(recievedMessage, payload);
      if (nextMessage === recievedMessage) return;
      handledMapPlacementIds.add(placement.placementId);
      shownMapIds.add(placement.mapId);
      recievedMessage = nextMessage;
      pushEvent(run, {
        type: 'map_placement',
        data: {
          placementId: placement.placementId,
          mapId: placement.mapId,
          handle: placement.handle,
          placementNumber: placement.placementNumber,
        },
        messageId: aiMessageId,
      });
      scheduleFlush(true);
    } else if (event.type === 'map_session_overlay') {
      const overlay = MapSessionOverlaySchema.safeParse(event.data);
      const purpose =
        overlay.success && overlay.data.route ? 'routing' : 'nearby';
      const locationSession = locationSessionForRun(run, purpose);
      const registration = overlay.success
        ? run.mapRegistry.resolveById(overlay.data.mapId)
        : undefined;
      if (
        !overlay.success ||
        !locationSession ||
        locationSession.retention !== 'once' ||
        overlay.data.clientSessionId !== run.clientSessionId ||
        !registration
      )
        return;
      const matchesOrigin = (coordinate: { lat: number; lon: number }) =>
        coordinate.lat === locationSession.coordinate.lat &&
        coordinate.lon === locationSession.coordinate.lon;
      if (
        (overlay.data.origin && !matchesOrigin(overlay.data.origin)) ||
        (overlay.data.route && !matchesOrigin(overlay.data.route.origin))
      )
        return;
      if (overlay.data.route) {
        const registeredRoute = registration.spec.route;
        if (
          !registeredRoute ||
          registeredRoute.mode !== overlay.data.route.mode ||
          registeredRoute.destination.lat !==
            overlay.data.route.destination.lat ||
          registeredRoute.destination.lon !==
            overlay.data.route.destination.lon ||
          registeredRoute.distanceMeters !==
            overlay.data.route.distanceMeters ||
          registeredRoute.durationSeconds !==
            overlay.data.route.durationSeconds ||
          registeredRoute.provider !== overlay.data.route.provider ||
          registeredRoute.attribution !== overlay.data.route.attribution
        ) {
          return;
        }
      }
      const overlayExpiresAt = overlay.data.expiresAt
        ? Date.parse(overlay.data.expiresAt)
        : locationSession.expiresAt;
      if (
        !Number.isFinite(overlayExpiresAt) ||
        overlayExpiresAt <= Date.now() ||
        overlayExpiresAt > locationSession.expiresAt
      )
        return;
      // Deliberately do not mutate content or metadata. runHub broadcasts this
      // event live-only and excludes it from the durable event log.
      pushEvent(run, {
        type: 'map_session_overlay',
        data: {
          ...overlay.data,
          ...(overlay.data.expiresAt
            ? {}
            : { expiresAt: new Date(locationSession.expiresAt).toISOString() }),
        },
        messageId: aiMessageId,
      });
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
        usedLocation: effectiveUsedLocation,
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
      } catch {
        // Approval payloads are an internal boundary. Never log their contents
        // (a malformed location payload could contain a raw coordinate).
        console.error('[runHost] handleInterrupts failed');
        emitStreamEvent(emitter, {
          type: 'agent_error',
          data: 'The approval request could not be created.',
        });
      }
    } else if (event.type === 'agent_end') {
      const endTime = Date.now();
      effectiveUsedLocation =
        effectiveUsedLocation ||
        Boolean(run.locationToken || run.locationRetention);
      modelStats = {
        ...modelStats,
        responseTime: endTime - startTime,
        usedLocation: effectiveUsedLocation,
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
        usedLocation: effectiveUsedLocation,
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
          usedLocation: effectiveUsedLocation,
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
        usedLocation: effectiveUsedLocation,
        usedPersonalization,
        ...(memoriesUsed.length > 0 && { memoriesUsed }),
        ...(Object.keys(visibleChartMetadata()).length > 0 && {
          chartSpecs: visibleChartMetadata(),
        }),
        ...(Object.keys(visibleMapMetadata()).length > 0 && {
          mapSpecs: visibleMapMetadata(),
        }),
        // no runStatus field = success
      });
    } else if (event.type === 'agent_error') {
      const safeError =
        run.locationToken || run.locationRetention
          ? 'The approved location could not be used; ask for a named origin instead.'
          : event.data;
      pushEvent(run, { type: 'error', data: safeError });

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
        ...(Object.keys(visibleMapMetadata()).length > 0 && {
          mapSpecs: visibleMapMetadata(),
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
