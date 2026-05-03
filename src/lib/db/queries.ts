import db from './index';
import { messages as messagesSchema } from './schema';
import { eq, asc, and, ne } from 'drizzle-orm';

export async function getChatMessages(chatId: string) {
  return db.query.messages.findMany({
    where: and(
      eq(messagesSchema.chatId, chatId),
      ne(messagesSchema.role, 'compaction'),
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
