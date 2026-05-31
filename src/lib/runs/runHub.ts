import type { EventEmitter } from 'stream';

export type RunStatus = 'running' | 'completed' | 'errored' | 'cancelled';

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
    status: 'running',
    emitter: params.emitter,
    eventLog: [],
    subscribers: new Map(),
    abortController: params.abortController,
    retrievalController: params.retrievalController,
    seq: 0,
    startedAt: Date.now(),
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

export function pushEvent(run: Run, ev: Record<string, unknown>): void {
  if (run.status !== 'running') return;

  const seqEvent: SeqEvent = { seq: ++run.seq, ev };
  run.eventLog.push(seqEvent);

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
  status: Exclude<RunStatus, 'running'>,
): void {
  if (run.status !== 'running') return;
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

  if (run.status === 'running') {
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

      // If already terminal, close after replay
      if (run.status !== 'running') {
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
