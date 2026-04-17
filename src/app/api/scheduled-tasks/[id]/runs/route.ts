import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { chats, messages as messagesSchema } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '20', 10),
    100,
  );
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const rows = await db
    .select()
    .from(chats)
    .where(eq(chats.scheduledTaskId, id))
    .orderBy(
      desc(
        sql`(SELECT MIN(${messagesSchema.id}) FROM ${messagesSchema} WHERE ${messagesSchema.chatId} = ${chats.id})`,
      ),
    )
    .limit(limit)
    .offset(offset);

  return Response.json(rows);
}
