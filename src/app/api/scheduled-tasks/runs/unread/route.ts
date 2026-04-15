import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET() {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(chats)
    .where(eq(chats.scheduledRunViewed, 0));

  return Response.json({ count: result[0]?.count ?? 0 });
}
