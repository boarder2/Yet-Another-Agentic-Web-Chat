import db from '@/lib/db';
import { runEvents } from '@/lib/db/schema';
import type { SeqEvent } from './runHub';
import type { StreamEvent } from '@/lib/streaming/events';
import {
  PersistableMapSpecSchema,
  MapSpecSchema,
  toPersistableMapSpec,
} from '@/lib/maps/types';
import {
  LocationApprovalPayloadSchema,
  LocationApprovalResponseSchema,
  containsCoordinateText,
} from '@/lib/maps/locationSessions';

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

type BufferedEvent = { seq: number; ev: StreamEvent };
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
  'stats',
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
  'chart_placement',
  'panel_executor_chart',
  'map_spec',
  'map_placement',
  'workspace_file_changed',
]);

/** Whether an event type should be persisted for reconstruction. */
export function isMilestoneEvent(type: string | undefined): boolean {
  if (!type) return false;
  if (MILESTONE_TYPES.has(type)) return true;
  // approval lifecycle: *_pending / *_answered / *_result / *_cancelled / *_stale
  return /_(pending|answered|result|cancelled|stale)$/.test(type);
}

/**
 * Sanitize structured map milestones before they enter the durable event log.
 * Session overlays intentionally return null: their exact origin/route is
 * live-only data, not a reconstruction milestone.
 */
const MAP_HANDLE_PATTERN = /^map_[1-9]\d*$/;

function isSafeMapIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001f\u007f<>]/.test(value) &&
    value !== '__proto__' &&
    value !== 'constructor' &&
    value !== 'prototype'
  );
}

function isSafeMapHandle(value: unknown): value is string {
  return typeof value === 'string' && MAP_HANDLE_PATTERN.test(value);
}

function isSafeMapSource(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    !/[\u0000-\u001f\u007f<>]/.test(value)
  );
}

function isValidMapPlacementNumber(value: unknown): value is number {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isInteger(value) && value === 1)
  );
}

function isSafeApprovalId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f<>]/.test(value)
  );
}

function isSafeApprovalText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    !/[\u0000-\u001f\u007f<>]/.test(value) &&
    !containsCoordinateText(value)
  );
}

/**
 * Keep location approval milestones coordinate-free even if a malformed
 * producer or legacy row reaches the persistence seam.
 */
export function locationEventForPersistence(
  event: StreamEvent,
): StreamEvent | null {
  if (
    event.type !== 'location_pending' &&
    event.type !== 'location_answered' &&
    event.type !== 'location_stale' &&
    event.type !== 'location_cancelled'
  ) {
    return null;
  }
  if (
    !event.data ||
    typeof event.data !== 'object' ||
    Array.isArray(event.data)
  ) {
    return null;
  }
  const data = event.data as Record<string, unknown>;
  if (!isSafeApprovalId(data.approvalId)) return null;
  // Rebuild the event instead of spreading the producer object. Location
  // milestones are a durable privacy boundary, so an unexpected top-level
  // coordinate/token field must be discarded as well as fields inside data.
  const messageId = isSafeApprovalId(event.messageId)
    ? { messageId: event.messageId }
    : {};

  if (event.type === 'location_pending') {
    const payload = LocationApprovalPayloadSchema.safeParse({
      ...(isSafeApprovalText(data.reason) ? { reason: data.reason } : {}),
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
    const toolCallId = data.toolCallId;
    const markupToolCallId = data.markupToolCallId;
    return {
      type: 'location_pending',
      ...messageId,
      data: {
        approvalId: data.approvalId,
        ...(isSafeApprovalId(toolCallId) ? { toolCallId } : {}),
        ...(isSafeApprovalId(markupToolCallId) ? { markupToolCallId } : {}),
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
    if (!isSafeApprovalText(data.reason)) return null;
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

export function mapEventForPersistence(
  event: StreamEvent,
  options: { retainRoute?: boolean; retainOrigin?: boolean } = {},
): StreamEvent | null {
  // Exact browser-origin data is never eligible for the durable event log.
  if (event.type === 'map_session_overlay') return null;
  if (event.type.startsWith('location_')) {
    return locationEventForPersistence(event);
  }
  if (event.type === 'map_spec') {
    if (!event.data || typeof event.data !== 'object') return null;
    const data = event.data;
    const handle = data.handle ?? data.turnHandle;
    if (
      !isSafeMapIdentity(data.mapId) ||
      (data.handle !== undefined &&
        data.turnHandle !== undefined &&
        data.handle !== data.turnHandle) ||
      (handle !== undefined && !isSafeMapHandle(handle))
    ) {
      return null;
    }

    const full = MapSpecSchema.safeParse(data.spec);
    const persistable = PersistableMapSpecSchema.safeParse(data.spec);
    if (!full.success && !persistable.success) return null;
    const spec = full.success
      ? toPersistableMapSpec(full.data, options)
      : persistable.success
        ? toPersistableMapSpec(persistable.data, options)
        : null;
    if (!spec) return null;

    return {
      type: 'map_spec',
      ...(isSafeApprovalId(event.messageId)
        ? { messageId: event.messageId }
        : {}),
      data: {
        mapId: data.mapId,
        spec,
        ...(typeof handle === 'string' ? { handle } : {}),
        ...(isSafeMapSource(data.source) ? { source: data.source } : {}),
      },
    };
  }
  if (event.type === 'map_placement') {
    if (
      !event.data ||
      typeof event.data !== 'object' ||
      Array.isArray(event.data)
    ) {
      return null;
    }
    const data = event.data;
    const handle = data.handle;
    if (
      !isSafeMapIdentity(data.placementId) ||
      !isSafeMapIdentity(data.mapId) ||
      (handle !== undefined && !isSafeMapHandle(handle)) ||
      !isValidMapPlacementNumber(data.placementNumber)
    ) {
      return null;
    }
    return {
      type: 'map_placement',
      ...(isSafeApprovalId(event.messageId)
        ? { messageId: event.messageId }
        : {}),
      data: {
        placementId: data.placementId,
        mapId: data.mapId,
        ...(handle !== undefined ? { handle } : {}),
        ...(data.placementNumber !== undefined
          ? { placementNumber: data.placementNumber }
          : {}),
      },
    };
  }
  return event;
}

export const sanitizeMapMilestone = mapEventForPersistence;
export const sanitizeLocationMilestone = locationEventForPersistence;

/** Buffer a milestone event for the given run. No-op for non-milestone types. */
export function enqueueRunEvent(
  messageId: string,
  chatId: string,
  seqEvent: SeqEvent,
  options: { retainRoute?: boolean; retainOrigin?: boolean } = {},
): void {
  const type = seqEvent.ev.type as string | undefined;
  if (!isMilestoneEvent(type)) return;
  const persistableEvent = mapEventForPersistence(seqEvent.ev, options);
  if (!persistableEvent) return;

  let buf = buffers.get(messageId);
  if (!buf) {
    buf = { chatId, events: [], timer: null };
    buffers.set(messageId, buf);
  }
  buf.events.push({ seq: seqEvent.seq, ev: persistableEvent });

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
    // Keep the batch attached to the live buffer when a transient database
    // failure occurs. A later flush can retry it, while a concurrently dropped
    // terminal buffer is left alone rather than resurrected.
    if (buffers.get(messageId) === buf) {
      buf.events = [...batch, ...buf.events];
    }
    console.warn('[runEventsPersistence] flush failed:', err);
  }
}

/** Discard any buffered events for a message (e.g. on eviction without flush). */
export function dropRunEventBuffer(messageId: string): void {
  const buf = buffers.get(messageId);
  if (buf?.timer) clearTimeout(buf.timer);
  buffers.delete(messageId);
}
