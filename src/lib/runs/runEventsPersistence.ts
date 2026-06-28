import db from '@/lib/db';
import { runEvents } from '@/lib/db/schema';
import type { SeqEvent } from './runHub';

/**
 * Buffered persistence of milestone run events into the `run_events` table so a
 * paused (awaiting_user) run can be reconstructed after eviction or a server
 * restart. Token-delta events are NOT persisted (too noisy); partial assistant
 * content is recovered from `messages.content` instead.
 *
 * Events are batched and flushed every 100ms (or immediately at 50 buffered),
 * with a forced synchronous flush on pause/terminate so post-pause reads see
 * everything.
 */

type BufferedEvent = { seq: number; ev: Record<string, unknown> };
type MessageBuffer = {
  chatId: string;
  events: BufferedEvent[];
  timer: ReturnType<typeof setTimeout> | null;
};

const buffers = new Map<string, MessageBuffer>();
const FLUSH_INTERVAL_MS = 100;
const FLUSH_THRESHOLD = 50;

// Exact milestone types the UI needs to rebuild a paused chat.
const MILESTONE_TYPES = new Set<string>([
  'sources',
  'sources_added',
  'tool_call_started',
  'tool_call_success',
  'tool_call_error',
  'subagent_started',
  'subagent_completed',
  'subagent_error',
  'panel_executor_started',
  'panel_executor_completed',
  'panel_executor_error',
  'todo_update',
  'chart_spec',
  'workspace_file_changed',
]);

/** Whether an event type should be persisted for reconstruction. */
export function isMilestoneEvent(type: string | undefined): boolean {
  if (!type) return false;
  if (MILESTONE_TYPES.has(type)) return true;
  // approval lifecycle: *_pending / *_answered / *_result / *_cancelled / *_stale
  return /_(pending|answered|result|cancelled|stale)$/.test(type);
}

/** Buffer a milestone event for the given run. No-op for non-milestone types. */
export function enqueueRunEvent(
  messageId: string,
  chatId: string,
  seqEvent: SeqEvent,
): void {
  const type = seqEvent.ev.type as string | undefined;
  if (!isMilestoneEvent(type)) return;

  let buf = buffers.get(messageId);
  if (!buf) {
    buf = { chatId, events: [], timer: null };
    buffers.set(messageId, buf);
  }
  buf.events.push({ seq: seqEvent.seq, ev: seqEvent.ev });

  if (buf.events.length >= FLUSH_THRESHOLD) {
    void flushRunEvents(messageId);
  } else if (!buf.timer) {
    buf.timer = setTimeout(() => {
      void flushRunEvents(messageId);
    }, FLUSH_INTERVAL_MS);
  }
}

/** Force-flush the buffered events for a message. Safe to await. */
export async function flushRunEvents(messageId: string): Promise<void> {
  const buf = buffers.get(messageId);
  if (!buf) return;
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  if (buf.events.length === 0) return;

  const batch = buf.events;
  buf.events = [];
  const now = Date.now();
  try {
    await db
      .insert(runEvents)
      .values(
        batch.map((e) => ({
          chatId: buf.chatId,
          messageId,
          seq: e.seq,
          type: (e.ev.type as string) ?? 'unknown',
          data: e.ev,
          createdAt: now,
        })),
      )
      .execute();
  } catch (err) {
    console.warn('[runEventsPersistence] flush failed:', err);
  }
}

/** Discard any buffered events for a message (e.g. on eviction without flush). */
export function dropRunEventBuffer(messageId: string): void {
  const buf = buffers.get(messageId);
  if (buf?.timer) clearTimeout(buf.timer);
  buffers.delete(messageId);
}
