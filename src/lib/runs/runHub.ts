import type { EventEmitter } from 'stream';

export type RunStatus =
  | 'running'
  | 'awaiting_user'
  | 'completed'
  | 'errored'
  | 'cancelled';

export type SeqEvent = {
  seq: number;
  ev: Record<string, unknown>;
};

type Subscriber = {
  id: string;
  controller: ReadableStreamDefaultController<string>;
  signal: AbortSignal;
  pingInterval?: ReturnType<typeof setInterval>;
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
export function pushEvent(run: Run, ev: Record<string, unknown>): void {
  if (run.status !== 'running' && run.status !== 'awaiting_user') return;

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
    if (sub.signal.aborted) {
      _removeSubscriber(sub);
      run.subscribers.delete(id);
      continue;
    }
    try {
      sub.controller.enqueue(JSON.stringify(ev) + '\n');
    } catch {
      _removeSubscriber(sub);
      run.subscribers.delete(id);
    }
  }
}

export function terminateRun(
  run: Run,
  status: Exclude<RunStatus, 'running' | 'awaiting_user'>,
): void {
  if (run.status !== 'running' && run.status !== 'awaiting_user') return;
  run.status = status;
  run.endedAt = Date.now();

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
        if (seqEvent.seq >= replayFrom) {
          try {
            controller.enqueue(JSON.stringify(seqEvent.ev) + '\n');
          } catch {
            return;
          }
        }
      }

      // Mark the boundary between buffered replay and live events. A
      // reconnecting client seeds its content from the persisted message (which
      // already reflects every replayed event), so it must skip replayed tokens
      // and only append the live ones that follow. Without this signal it cannot
      // tell the two apart and drops post-resume tokens equal to the seeded length.
      try {
        controller.enqueue(JSON.stringify({ type: 'replay_complete' }) + '\n');
      } catch {
        return;
      }

      // If already terminal (not running or awaiting_user), close after replay
      if (run.status !== 'running' && run.status !== 'awaiting_user') {
        controller.close();
        return;
      }

      // Register subscriber for live events
      const sub: Subscriber = {
        id: subId,
        controller,
        signal: requestSignal,
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
