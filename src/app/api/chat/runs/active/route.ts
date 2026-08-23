import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { isNotNull, isNull, eq, and, count } from 'drizzle-orm';

export const GET = async () => {
  try {
    // Scheduled runs have separate in-progress state in the schedules list.
    const activeRows = await db
      .select({
        id: chats.id,
        title: chats.title,
        activeRunMessageId: chats.activeRunMessageId,
        activeRunStartedAt: chats.activeRunStartedAt,
        activeRunStatus: chats.activeRunStatus,
      })
      .from(chats)
      .where(
        and(isNotNull(chats.activeRunMessageId), isNull(chats.scheduleId)),
      );

    // The chat marker is durable and is also what History uses for its status.
    // Do not derive UI state from the process-local run hub: a reconnect can
    // reach a different handler instance while the original run is still live.
    const active = activeRows.map((row) => ({
      chatId: row.id,
      messageId: row.activeRunMessageId!,
      startedAt: row.activeRunStartedAt ?? 0,
      status:
        row.activeRunStatus === 'awaiting_user'
          ? ('awaiting_user' as const)
          : ('running' as const),
      chatTitle: row.title,
    }));

    const awaitingAttentionCount = active.filter(
      (r) => r.status === 'awaiting_user',
    ).length;

    // Unread = a finished run the user hasn't seen, scheduled or interactive.
    // Mirror ChatRow's badge condition: lastRunViewed 0, a terminal status, and
    // no run currently in flight (a run resets lastRunViewed to 0 on start, so
    // the active guard keeps it from counting until it finishes).
    const [{ value: unreadCount }] = await db
      .select({ value: count() })
      .from(chats)
      .where(
        and(
          eq(chats.lastRunViewed, 0),
          isNull(chats.activeRunMessageId),
          isNotNull(chats.lastRunStatus),
        ),
      );

    return Response.json({
      active,
      // Retained for clients that consumed the old response shape. Durable
      // chat markers now define active state, so there are no stale entries.
      stale: [],
      unreadCount,
      awaitingAttentionCount,
    });
  } catch (err) {
    console.error('[/api/chat/runs/active] failed:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
};
