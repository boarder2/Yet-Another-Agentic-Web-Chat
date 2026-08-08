import db from './db';
import { chats, messages } from './db/schema';
import { eq } from 'drizzle-orm';
import { getPrivateSessionDurationMinutes } from './settings/server';
import { getRunByChatId } from './runs/runHub';
import { deleteForChat as deleteHistoryForChat } from './history/service';

export async function cleanupExpiredPrivateSessions(): Promise<number> {
  const durationMs = getPrivateSessionDurationMinutes() * 60 * 1000;
  const cutoffMs = Date.now() - durationMs;

  // Fetch all private chats and filter by createdAt (ms integer) in JS
  const privateChats = await db
    .select({ id: chats.id, createdAt: chats.createdAt })
    .from(chats)
    .where(eq(chats.isPrivate, 1));

  const expired = privateChats.filter((chat) => {
    const ts = chat.createdAt;
    return ts < cutoffMs;
  });

  for (const chat of expired) {
    // Skip chats whose run is still active — next cron pass will catch them
    if (getRunByChatId(chat.id)?.status === 'running') continue;
    await db.delete(messages).where(eq(messages.chatId, chat.id));
    await db.delete(chats).where(eq(chats.id, chat.id));
    // Artifact tools are excluded in private chats, but history rows can still
    // exist when a chat was made private after the fact.
    deleteHistoryForChat(chat.id);
  }

  return expired.length;
}
