import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

// Unread = a finished scheduled run the user hasn't viewed. Exclude in-flight
// runs (activeRunMessageId set) so the badge only counts once a run completes.
export async function GET() {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(chats)
    .where(
      and(
        isNotNull(chats.scheduleId),
        eq(chats.scheduledRunViewed, 0),
        isNull(chats.activeRunMessageId),
      ),
    );

  return Response.json({ count: result[0]?.count ?? 0 });
}
