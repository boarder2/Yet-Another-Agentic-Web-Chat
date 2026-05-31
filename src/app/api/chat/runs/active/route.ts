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
        activeRunMessageId: chats.activeRunMessageId,
        activeRunStartedAt: chats.activeRunStartedAt,
      })
      .from(chats)
      .where(
        and(isNotNull(chats.activeRunMessageId), isNull(chats.scheduledTaskId)),
      );

    const active: { chatId: string; messageId: string; startedAt: number }[] =
      [];
    const stale: string[] = [];

    for (const row of activeRows) {
      const messageId = row.activeRunMessageId!;
      const hubRun = getRun(messageId);
      if (hubRun?.status === 'running') {
        active.push({
          chatId: row.id,
          messageId,
          startedAt: row.activeRunStartedAt ?? hubRun.startedAt,
        });
      } else {
        stale.push(row.id);
      }
    }

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

    return Response.json({ active, stale, unreadCount });
  } catch (err) {
    console.error('[/api/chat/runs/active] failed:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
};
