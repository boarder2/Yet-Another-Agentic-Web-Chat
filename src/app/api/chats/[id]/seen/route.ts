import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { eq, and, isNull, isNotNull, count, sql } from 'drizzle-orm';

export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    // Only mark the latest run viewed when no run is currently active. While a
    // run is in flight the "viewed" decision is deferred to run completion
    // (runHost terminate uses live-subscriber presence): pre-marking here would
    // make a thread you opened but navigated away from appear read once it
    // finishes.
    const updated = await db
      .update(chats)
      .set({
        lastRunViewed: sql`CASE WHEN ${chats.activeRunMessageId} IS NULL THEN 1 ELSE ${chats.lastRunViewed} END`,
      })
      .where(eq(chats.id, id))
      .returning({ id: chats.id });

    if (!updated[0]) {
      return Response.json({ error: 'Chat not found' }, { status: 404 });
    }

    // historyCount: remaining global unread runs (used by Sidebar to trigger a
    // refetch; exact value isn't critical but kept accurate). Mirror
    // ChatRow/active-runs: only finished, unseen runs with no run in flight.
    const [{ historyCount }] = await db
      .select({ historyCount: count() })
      .from(chats)
      .where(
        and(
          eq(chats.lastRunViewed, 0),
          isNull(chats.activeRunMessageId),
          isNotNull(chats.lastRunStatus),
        ),
      );

    return Response.json({ historyCount });
  } catch (err) {
    console.error('[/api/chats/[id]/seen] failed:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
};
