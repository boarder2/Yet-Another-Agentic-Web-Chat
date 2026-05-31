import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params;

  await db
    .update(chats)
    .set({ scheduledRunViewed: 1 })
    .where(and(eq(chats.id, chatId), eq(chats.scheduledRunViewed, 0)))
    .execute();

  // Return updated unread count (exclude in-flight runs, matching the badge)
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(chats)
    .where(
      and(eq(chats.scheduledRunViewed, 0), isNull(chats.activeRunMessageId)),
    );

  return Response.json({ count: result[0]?.count ?? 0 });
}
