import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { getRun } from '@/lib/runs/runHub';
import { isNotNull, isNull, eq, and, count } from 'drizzle-orm';

export const GET = async () => {
  try {
    // Scheduled runs set the same activeRunMessageId marker but run headless
    // (no hub Run), so they'd always fall into `stale` here. Exclude them — the
    // scheduled-tasks list tracks their in-progress state separately.
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
        and(isNotNull(chats.activeRunMessageId), isNull(chats.scheduledTaskId)),
      );

    const active: {
      chatId: string;
      messageId: string;
      startedAt: number;
      status: 'running' | 'awaiting_user';
      chatTitle?: string;
    }[] = [];
    const stale: string[] = [];

    for (const row of activeRows) {
      const messageId = row.activeRunMessageId!;
      const hubRun = getRun(messageId);

      if (row.activeRunStatus === 'awaiting_user') {
        // Durable paused run — include regardless of hub presence (may be evicted)
        active.push({
          chatId: row.id,
          messageId,
          startedAt: row.activeRunStartedAt ?? 0,
          status: 'awaiting_user',
          chatTitle: row.title,
        });
      } else if (hubRun?.status === 'running') {
        active.push({
          chatId: row.id,
          messageId,
          startedAt: row.activeRunStartedAt ?? hubRun.startedAt,
          status: 'running',
          chatTitle: row.title,
        });
      } else {
        stale.push(row.id);
      }
    }

    const awaitingAttentionCount = active.filter(
      (r) => r.status === 'awaiting_user',
    ).length;

    // Unread = a finished run the user hasn't seen. Mirror ChatRow's badge
    // condition: lastRunViewed 0, a terminal status, and no run currently in
    // flight (a run resets lastRunViewed to 0 on start, so the active guard
    // keeps it from counting until it finishes).
    const [{ value: unreadCount }] = await db
      .select({ value: count() })
      .from(chats)
      .where(
        and(
          eq(chats.lastRunViewed, 0),
          isNull(chats.scheduledTaskId),
          isNull(chats.activeRunMessageId),
          isNotNull(chats.lastRunStatus),
        ),
      );

    return Response.json({
      active,
      stale,
      unreadCount,
      awaitingAttentionCount,
    });
  } catch (err) {
    console.error('[/api/chat/runs/active] failed:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
};
