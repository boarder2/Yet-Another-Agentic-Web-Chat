import db from './index';
import { messages as messagesSchema } from './schema';
import { eq, asc, and, ne, notInArray } from 'drizzle-orm';

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

export async function getCompactionRows(chatId: string) {
  return db.query.messages.findMany({
    where: and(
      eq(messagesSchema.chatId, chatId),
      eq(messagesSchema.role, 'compaction'),
    ),
    orderBy: asc(messagesSchema.id),
  });
}
