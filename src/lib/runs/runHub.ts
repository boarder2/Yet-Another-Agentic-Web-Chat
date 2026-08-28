import type { EventEmitter } from 'stream';
import type { StreamEvent } from '@/lib/streaming/events';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import type { MappingConfiguration } from '@/lib/maps/config';
import type { MappingService } from '@/lib/maps/service';
import {
  MapSessionOverlaySchema,
  type MapSessionOverlay,
} from '@/lib/maps/types';
import {
  clearLocationTokensForRun,
  containsCoordinateText,
  normalizeClientSessionId,
} from '@/lib/maps/locationSessions';
import {
  LocationApprovalPayloadSchema,
  LocationApprovalResponseSchema,
} from '@/lib/maps/locationSchemas';

export type RunStatus =
  'running' | 'awaiting_user' | 'completed' | 'errored' | 'cancelled';

export type SeqEvent = {
  seq: number;
  ev: StreamEvent;
};

type Subscriber = {
  id: string;
  controller: ReadableStreamDefaultController<string>;
  signal: AbortSignal;
  clientSessionId?: string;
  pingInterval?: ReturnType<typeof setInterval>;
};

type SessionOverlayEvent = Extract<
  StreamEvent,
  { type: 'map_session_overlay' }
>;

type SessionOverlayEntry = {
  event: SessionOverlayEvent;
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
};

export type Run = {
  chatId: string;
  messageId: string; // user message ID (run key)
  aiMessageId: string; // assistant message ID
  threadId: string; // LangGraph thread_id = `${messageId}:${startedAt}`
  status: RunStatus;
  emitter: EventEmitter;
  eventLog: SeqEvent[];
  subscribers: Map<string, Subscriber>;
  abortController: AbortController;
  retrievalController: AbortController;
  seq: number;
  startedAt: number;
  endedAt?: number;
  bufferTruncatedFrom?: number;
  ttlTimer?: ReturnType<typeof setTimeout>;
  // Seeded from persisted messages.content on lazy reconstruction so
  // post-resume tokens append rather than overwrite.
  recievedMessage: string;
  /** Turn-local chart handles shared by tools, runHost, and resume. */
  chartRegistry: TurnChartRegistry;
  /** Turn-local place and route handles shared by tools, runHost, and resume. */
  mapRegistry: TurnMapRegistry;
  /** Server-only mapping facade and its initial configuration snapshot. */
  mappingConfig?: MappingConfiguration | null;
  mappingService?: MappingService | null;
  /** Page session that initiated/approved the current interactive turn. */
  clientSessionId?: string;
  /** Exact overlays live only while this in-memory run is active. */
  sessionOverlays?: Map<string, SessionOverlayEntry>;
  /** Opaque current-location token; its coordinate stays in the token store. */
  locationToken?: string;
  /** Approval that minted the token; prevents cross-approval reuse. */
  locationApprovalId?: string;
  /** Retention choice is safe bookkeeping used to redact late route events. */
  locationRetention?: 'once' | 'save';
};

type Registry = {
  byMessageId: Map<string, Run>;
  byChatId: Map<string, Run>;
};

declare global {
  var __runHub: Registry | undefined;
}

const BUFFER_MAX_EVENTS = 5000;
const RUN_TTL_MS = 60_000;
const AWAITING_USER_IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getRegistry(): Registry {
  if (!globalThis.__runHub) {
    globalThis.__runHub = {
      byMessageId: new Map(),
      byChatId: new Map(),
    };
  }
  return globalThis.__runHub;
}

export function startRun(params: {
  chatId: string;
  messageId: string;
  aiMessageId: string;
  threadId: string;
  emitter: EventEmitter;
  abortController: AbortController;
  retrievalController: AbortController;
  chartRegistry?: TurnChartRegistry;
  mapRegistry?: TurnMapRegistry;
  mappingConfig?: MappingConfiguration | null;
  mappingService?: MappingService | null;
  clientSessionId?: string;
}): { run: Run; isNew: boolean } {
  const reg = getRegistry();
  const existing = reg.byMessageId.get(params.messageId);
  if (existing && existing.status === 'running') {
    return { run: existing, isNew: false };
  }

  const run: Run = {
    chatId: params.chatId,
    messageId: params.messageId,
    aiMessageId: params.aiMessageId,
    threadId: params.threadId,
    status: 'running',
    emitter: params.emitter,
    eventLog: [],
    subscribers: new Map(),
    abortController: params.abortController,
    retrievalController: params.retrievalController,
    seq: 0,
    startedAt: Date.now(),
    recievedMessage: '',
    chartRegistry: params.chartRegistry ?? new TurnChartRegistry(),
    mapRegistry: params.mapRegistry ?? new TurnMapRegistry(),
    mappingConfig: params.mappingConfig ?? null,
    mappingService: params.mappingService ?? null,
    clientSessionId:
      normalizeClientSessionId(params.clientSessionId) ?? undefined,
    sessionOverlays: new Map(),
  };

  reg.byMessageId.set(params.messageId, run);
  reg.byChatId.set(params.chatId, run);

  return { run, isNew: true };
}

export function getRun(messageId: string): Run | undefined {
  return getRegistry().byMessageId.get(messageId);
}

export function getRunByChatId(chatId: string): Run | undefined {
  return getRegistry().byChatId.get(chatId);
}

export function setRunStatus(run: Run, status: RunStatus): void {
  run.status = status;
}

// Optional sink for persisting events (registered by runHost). Kept as a hook
// so runHub stays free of DB dependencies.
let eventPersister: ((run: Run, seqEvent: SeqEvent) => void) | null = null;
export function setEventPersister(
  fn: ((run: Run, seqEvent: SeqEvent) => void) | null,
): void {
  eventPersister = fn;
}

/**
 * Push an event into the run's eventLog and broadcast to all subscribers.
 * Allowed for both 'running' and 'awaiting_user' states.
 */
function overlayKey(clientSessionId: string, mapId: string): string {
  return `${clientSessionId}:${mapId}`;
}

function overlaysFor(run: Run): Map<string, SessionOverlayEntry> {
  if (!run.sessionOverlays) run.sessionOverlays = new Map();
  return run.sessionOverlays;
}

function removeSessionOverlay(run: Run, key: string): void {
  const entry = overlaysFor(run).get(key);
  if (!entry) return;
  if (entry.expiryTimer !== undefined) clearTimeout(entry.expiryTimer);
  overlaysFor(run).delete(key);
}

function clearSessionOverlays(run: Run): void {
  const overlays = overlaysFor(run);
  for (const entry of overlays.values()) {
    if (entry.expiryTimer !== undefined) clearTimeout(entry.expiryTimer);
  }
  overlays.clear();
}

function scheduleSessionOverlayExpiry(
  run: Run,
  key: string,
  expiresAt: number,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(
    () => {
      const entry = overlaysFor(run).get(key);
      if (!entry || entry.expiresAt !== expiresAt) return;
      // The timer is the upper bound for the process-local precise copy. A
      // later `pruneSessionOverlays` call remains a second line of defence.
      removeSessionOverlay(run, key);
    },
    Math.max(1, expiresAt - Date.now()),
  );
  const unref = (timer as unknown as { unref?: () => void }).unref;
  if (unref) unref.call(timer);
  return timer;
}

function pruneSessionOverlays(run: Run, now = Date.now()): void {
  const overlays = overlaysFor(run);
  for (const [key, entry] of overlays) {
    if (entry.expiresAt <= now) removeSessionOverlay(run, key);
  }
}

function subscriberMayReceiveOverlay(
  run: Run,
  subscriber: Subscriber,
  overlay: MapSessionOverlay,
): boolean {
  // Precise overlays have no safe legacy/unbound form. Both the run and the
  // subscriber must carry the exact page-session binding that the overlay
  // carries; an unbound run must never deliver exact browser data.
  return (
    run.clientSessionId !== undefined &&
    subscriber.clientSessionId === run.clientSessionId &&
    overlay.clientSessionId === run.clientSessionId
  );
}

function enqueueSubscriber(
  run: Run,
  id: string,
  sub: Subscriber,
  event: StreamEvent,
): void {
  if (sub.signal.aborted) {
    _removeSubscriber(sub);
    run.subscribers.delete(id);
    return;
  }
  try {
    sub.controller.enqueue(JSON.stringify(event) + '\n');
  } catch {
    _removeSubscriber(sub);
    run.subscribers.delete(id);
  }
}

function safeLocationIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f<>]/.test(value)
  );
}

/**
 * Keep location approval events coordinate/token-free before they enter the
 * hub's live buffer. The run host applies the same boundary before this point,
 * but the hub must not trust a future producer or a malformed replay bridge.
 */
function sanitizeLocationStreamEvent(event: StreamEvent): StreamEvent | null {
  if (!event.type.startsWith('location_')) return event;
  const raw = event as unknown as {
    type: string;
    data?: unknown;
    messageId?: unknown;
  };
  if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data))
    return null;
  const data = raw.data as Record<string, unknown>;
  if (!safeLocationIdentifier(data.approvalId)) return null;
  const messageId = safeLocationIdentifier(raw.messageId)
    ? { messageId: raw.messageId }
    : {};

  if (event.type === 'location_pending') {
    const payload = LocationApprovalPayloadSchema.safeParse({
      reason: data.reason,
      authorizedPurposes: data.authorizedPurposes,
      authorizedHosts: data.authorizedHosts,
      providerHosts: data.providerHosts,
      tileHosts: data.tileHosts,
      configHash: data.configHash,
      clientSessionId: data.clientSessionId,
      aiMessageId: data.aiMessageId,
      allowSave: data.allowSave,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
    });
    if (!payload.success) return null;
    return {
      type: 'location_pending',
      ...messageId,
      data: {
        approvalId: data.approvalId,
        ...(safeLocationIdentifier(data.toolCallId)
          ? { toolCallId: data.toolCallId }
          : {}),
        ...(safeLocationIdentifier(data.markupToolCallId)
          ? { markupToolCallId: data.markupToolCallId }
          : {}),
        ...payload.data,
      },
    } as StreamEvent;
  }

  if (event.type === 'location_answered') {
    const response = LocationApprovalResponseSchema.safeParse(data.response);
    if (!response.success) return null;
    const safeResponse = response.data.approved
      ? { approved: true as const, retention: response.data.retention }
      : {
          approved: false as const,
          retention: 'once' as const,
          ...(response.data.reason ? { reason: response.data.reason } : {}),
        };
    return {
      type: 'location_answered',
      ...messageId,
      data: { approvalId: data.approvalId, response: safeResponse },
    } as StreamEvent;
  }

  if (event.type === 'location_stale') {
    if (
      typeof data.reason !== 'string' ||
      data.reason.length === 0 ||
      data.reason.length > 240 ||
      /[\u0000-\u001f\u007f<>]/.test(data.reason) ||
      containsCoordinateText(data.reason)
    ) {
      return null;
    }
    return {
      type: 'location_stale',
      ...messageId,
      data: { approvalId: data.approvalId, reason: data.reason },
    } as StreamEvent;
  }

  return {
    type: 'location_cancelled',
    ...messageId,
    data: { approvalId: data.approvalId },
  } as StreamEvent;
}

export function pushEvent(run: Run, ev: StreamEvent): void {
  if (run.status !== 'running' && run.status !== 'awaiting_user') return;
  const sanitizedEvent = sanitizeLocationStreamEvent(ev);
  if (!sanitizedEvent) return;
  ev = sanitizedEvent;

  // Precise browser-origin overlays are stored only in this process and keyed
  // by the approving page session. They never receive a sequence number,
  // enter eventLog, or reach the generic event persister.
  if (ev.type === 'map_session_overlay') {
    const parsed = MapSessionOverlaySchema.safeParse(ev.data);
    if (!parsed.success || !parsed.data.clientSessionId) return;
    const overlay = parsed.data;
    const clientSessionId = overlay.clientSessionId;
    if (!clientSessionId) return;
    if (ev.messageId !== undefined && ev.messageId !== run.aiMessageId) return;

    // A precise overlay is valid only for a page-bound run and a registered
    // provider map. There is no unbound delivery path, even for an empty
    // registry; every overlay belongs to a composed map placement.
    if (
      !run.clientSessionId ||
      overlay.clientSessionId !== run.clientSessionId ||
      !run.mapRegistry.resolveById(overlay.mapId)
    ) {
      return;
    }
    const now = Date.now();
    const expiresAt = overlay.expiresAt
      ? Date.parse(overlay.expiresAt)
      : now + 10 * 60 * 1000;
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + 10 * 60 * 1000
    )
      return;
    const normalizedOverlay = overlay.expiresAt
      ? overlay
      : { ...overlay, expiresAt: new Date(expiresAt).toISOString() };
    // Rebuild the event from the allow-listed payload instead of spreading the
    // producer object. The overlay is a sensitive live boundary, so an extra
    // top-level field can never smuggle precise data to a subscriber.
    const event: SessionOverlayEvent = {
      type: 'map_session_overlay',
      ...(ev.messageId ? { messageId: ev.messageId } : {}),
      data: normalizedOverlay,
    };
    pruneSessionOverlays(run, now);
    const key = overlayKey(clientSessionId, overlay.mapId);
    const overlays = overlaysFor(run);
    const prior = overlays.get(key);
    if (prior?.expiryTimer !== undefined) clearTimeout(prior.expiryTimer);
    const entry: SessionOverlayEntry = { event, expiresAt };
    entry.expiryTimer = scheduleSessionOverlayExpiry(run, key, expiresAt);
    overlays.set(key, entry);
    for (const [id, sub] of run.subscribers) {
      if (subscriberMayReceiveOverlay(run, sub, overlay)) {
        enqueueSubscriber(run, id, sub, event);
      }
    }
    return;
  }

  const seqEvent: SeqEvent = { seq: ++run.seq, ev };
  run.eventLog.push(seqEvent);

  // Persist milestone events for cross-restart reconstruction (filtered in the sink).
  if (eventPersister) {
    try {
      eventPersister(run, seqEvent);
    } catch {
      // persistence is best-effort; never block the live stream
    }
  }

  // Buffer cap enforcement: drop oldest events if over limit
  if (run.eventLog.length > BUFFER_MAX_EVENTS) {
    const dropped = run.eventLog.splice(
      0,
      run.eventLog.length - BUFFER_MAX_EVENTS,
    );
    const lastDropped = dropped[dropped.length - 1];
    if (lastDropped) {
      run.bufferTruncatedFrom = lastDropped.seq + 1;
    }
  }

  // Notify all subscribers
  for (const [id, sub] of run.subscribers) {
    enqueueSubscriber(run, id, sub, ev);
  }
}

export function terminateRun(
  run: Run,
  status: Exclude<RunStatus, 'running' | 'awaiting_user'>,
): void {
  if (run.status !== 'running' && run.status !== 'awaiting_user') return;
  run.status = status;
  run.endedAt = Date.now();
  // A terminal run can only replay its redacted milestones; provider facades
  // and precise runtime state must not remain usable during the retention window.
  run.mappingService = null;
  run.mappingConfig = null;
  run.locationToken = undefined;
  run.locationApprovalId = undefined;
  run.locationRetention = undefined;
  clearSessionOverlays(run);
  run.mapRegistry.clear();
  clearLocationTokensForRun(run.messageId);
  clearLocationTokensForRun(run.threadId);

  // Close all subscribers
  for (const [, sub] of run.subscribers) {
    _removeSubscriber(sub);
    try {
      sub.controller.close();
    } catch {
      // already closed
    }
  }
  run.subscribers.clear();

  // Schedule TTL eviction
  run.ttlTimer = setTimeout(() => {
    _evictRun(run);
  }, RUN_TTL_MS);
}

/**
 * Pause a run at an interrupt. Subscribers stay connected; the run stays
 * in the hub. An idle eviction timer is scheduled to reclaim memory if no
 * one subscribes for 30 minutes.
 */
export function pauseRun(run: Run): void {
  if (run.status !== 'running') return;
  run.status = 'awaiting_user';
  _scheduleIdleEviction(run);
}

function _scheduleIdleEviction(run: Run): void {
  if (run.ttlTimer !== undefined) clearTimeout(run.ttlTimer);
  run.ttlTimer = setTimeout(() => {
    if (run.subscribers.size === 0) {
      _evictRun(run);
    } else {
      // Subscribers active — delay eviction check by another cycle
      _scheduleIdleEviction(run);
    }
  }, AWAITING_USER_IDLE_TTL_MS);
}

/**
 * Register a reconstructed awaiting_user Run from DB. Used by lazy
 * reconstruction so it lands in the hub with the right state.
 */
export function registerReconstructedRun(run: Run): void {
  const reg = getRegistry();
  reg.byMessageId.set(run.messageId, run);
  reg.byChatId.set(run.chatId, run);
  _scheduleIdleEviction(run);
}

function _removeSubscriber(sub: Subscriber): void {
  if (sub.pingInterval !== undefined) {
    clearInterval(sub.pingInterval);
    sub.pingInterval = undefined;
  }
}

function _evictRun(run: Run): void {
  // Provider facades are run-lifetime state only; durable replay contains
  // redacted map milestones and never needs this live dependency.
  run.mappingService = null;
  run.mappingConfig = null;
  run.locationToken = undefined;
  run.locationApprovalId = undefined;
  run.locationRetention = undefined;
  clearSessionOverlays(run);
  run.mapRegistry.clear();
  clearLocationTokensForRun(run.messageId);
  clearLocationTokensForRun(run.threadId);
  const reg = getRegistry();
  if (run.ttlTimer !== undefined) {
    clearTimeout(run.ttlTimer);
    run.ttlTimer = undefined;
  }
  reg.byMessageId.delete(run.messageId);
  if (reg.byChatId.get(run.chatId) === run) {
    reg.byChatId.delete(run.chatId);
  }
}

/** Forcibly evict a run by chatId (e.g. on chat deletion). */
export function evictByChatId(chatId: string): void {
  const reg = getRegistry();
  const run = reg.byChatId.get(chatId);
  if (!run) return;

  if (run.ttlTimer !== undefined) clearTimeout(run.ttlTimer);

  if (run.status === 'running' || run.status === 'awaiting_user') {
    run.status = 'cancelled';
    for (const [, sub] of run.subscribers) {
      _removeSubscriber(sub);
      try {
        sub.controller.close();
      } catch {
        // already closed
      }
    }
    run.subscribers.clear();
  }

  run.locationToken = undefined;
  run.locationApprovalId = undefined;
  run.locationRetention = undefined;
  clearSessionOverlays(run);
  clearLocationTokensForRun(run.messageId);
  clearLocationTokensForRun(run.threadId);
  _evictRun(run);
}

/** GC sweep: remove runs whose TTL has elapsed. Called from retention cron. */
export function gcRuns(): void {
  const reg = getRegistry();
  const now = Date.now();
  for (const [, run] of reg.byMessageId) {
    if (
      run.status !== 'running' &&
      run.status !== 'awaiting_user' &&
      run.endedAt !== undefined &&
      now - run.endedAt > RUN_TTL_MS
    ) {
      _evictRun(run);
    }
  }
}

/**
 * Subscribe to a run's event stream, replaying buffered events from `from`
 * and then tailing live events. Returns a ReadableStream<string> where each
 * chunk is a JSON line followed by '\n'.
 */
export function subscribe(
  run: Run,
  from: number,
  requestSignal: AbortSignal,
  clientSessionId?: string,
): ReadableStream<string> {
  const subId = crypto.randomUUID();

  return new ReadableStream<string>({
    start(controller) {
      // Determine replay start, respecting buffer truncation
      const replayFrom =
        run.bufferTruncatedFrom != null
          ? Math.max(from, run.bufferTruncatedFrom)
          : from;

      // Replay buffered events
      for (const seqEvent of run.eventLog) {
        if (
          seqEvent.seq >= replayFrom &&
          seqEvent.ev.type !== 'map_session_overlay'
        ) {
          try {
            controller.enqueue(JSON.stringify(seqEvent.ev) + '\n');
          } catch {
            return;
          }
        }
      }

      // Mark the boundary between buffered replay and live events, and hand the
      // client the run's true accumulated content as of this instant. The
      // client's own seed comes from a DB read (messages.content), which is
      // flushed on a debounce and can lag behind what's already been broadcast
      // over SSE — trusting it blindly drops tokens that were sent live but not
      // yet persisted when the client reconnected. `run.recievedMessage` is
      // updated synchronously on every event (see runHost's scheduleFlush), so
      // it's always current; the client corrects its seed to this value before
      // switching from replay (skip) to live (append) mode.
      try {
        controller.enqueue(
          JSON.stringify({
            type: 'replay_complete',
            content: run.recievedMessage,
          }) + '\n',
        );
      } catch {
        return;
      }

      // If already terminal (not running or awaiting_user), close after replay.
      // Exact overlays are cleared at termination and are never reconstructed
      // from a terminal run.
      if (run.status !== 'running' && run.status !== 'awaiting_user') {
        controller.close();
        return;
      }

      // Register subscriber for live events
      const sub: Subscriber = {
        id: subId,
        controller,
        signal: requestSignal,
        clientSessionId: normalizeClientSessionId(clientSessionId) ?? undefined,
      };

      // Per-subscriber keep-alive ping
      sub.pingInterval = setInterval(() => {
        if (requestSignal.aborted) {
          clearInterval(sub.pingInterval);
          sub.pingInterval = undefined;
          return;
        }
        try {
          controller.enqueue(
            JSON.stringify({ type: 'ping', timestamp: Date.now() }) + '\n',
          );
        } catch {
          if (sub.pingInterval !== undefined) {
            clearInterval(sub.pingInterval);
            sub.pingInterval = undefined;
          }
        }
      }, 30_000);

      run.subscribers.set(subId, sub);

      // Re-deliver only the exact overlays belonging to this page session. They
      // are intentionally absent for a fresh/reloaded session.
      pruneSessionOverlays(run);
      for (const entry of overlaysFor(run).values()) {
        if (
          subscriberMayReceiveOverlay(run, sub, entry.event.data) &&
          entry.expiresAt > Date.now()
        ) {
          enqueueSubscriber(run, subId, sub, entry.event);
        }
      }

      // Remove subscriber when request disconnects
      requestSignal.addEventListener('abort', () => {
        run.subscribers.delete(subId);
        _removeSubscriber(sub);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      const sub = run.subscribers.get(subId);
      if (sub) {
        _removeSubscriber(sub);
        run.subscribers.delete(subId);
      }
    },
  });
}
