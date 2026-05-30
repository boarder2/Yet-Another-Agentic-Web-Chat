import db from './index';
import { messages as messagesSchema } from './schema';
import { eq, asc, and, ne, notInArray, sql } from 'drizzle-orm';

export async function getChatMessages(
  chatId: string,
  opts?: { includeSystem?: boolean },
) {
  const includeSystem = opts?.includeSystem ?? false;
  return db.query.messages.findMany({
    where: and(
      eq(messagesSchema.chatId, chatId),
      includeSystem
        ? ne(messagesSchema.role, 'compaction')
        : notInArray(messagesSchema.role, ['compaction', 'system']),
    ),
    orderBy: asc(messagesSchema.id),
  });
}

/**
 * Sum of `content` character lengths across a chat's non-compaction messages,
 * computed in SQL so the next-turn token projection doesn't have to load every
 * message row into memory. When `afterMessageId` is given, only rows persisted
 * after that message (this turn's new system/tool-context rows) are counted.
 */
export async function sumMessageContentChars(
  chatId: string,
  opts?: { afterMessageId?: string },
): Promise<number> {
  const conditions = [
    eq(messagesSchema.chatId, chatId),
    ne(messagesSchema.role, 'compaction'),
  ];
  if (opts?.afterMessageId) {
    conditions.push(
      sql`${messagesSchema.id} > (select id from messages where "chatId" = ${chatId} and "messageId" = ${opts.afterMessageId} limit 1)`,
    );
  }
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(length(${messagesSchema.content})), 0)`,
    })
    .from(messagesSchema)
    .where(and(...conditions));
  return Number(rows?.[0]?.total ?? 0);
}

export async function getCompactionRows(chatId: string) {
  return db.query.messages.findMany({
    where: and(
      eq(messagesSchema.chatId, chatId),
      eq(messagesSchema.role, 'compaction'),
    ),
    orderBy: asc(messagesSchema.id),
  });
}
