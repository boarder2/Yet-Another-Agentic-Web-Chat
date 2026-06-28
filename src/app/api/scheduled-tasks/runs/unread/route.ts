import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET() {
  // Unread = a finished scheduled run the user hasn't viewed. Exclude runs
  // still in flight (activeRunMessageId set) so the badge only counts once the
  // run completes, mirroring the history unread badge.
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(chats)
    .where(
      and(eq(chats.scheduledRunViewed, 0), isNull(chats.activeRunMessageId)),
    );

  return Response.json({ count: result[0]?.count ?? 0 });
}
