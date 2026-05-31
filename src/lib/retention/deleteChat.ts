import db from '@/lib/db';
import { chats, messages, memories, scheduledTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { evictByChatId, getRunByChatId } from '@/lib/runs/runHub';

/**
 * Delete a chat and clean up references atomically.
 * - Deletes all messages for the chat.
 * - NULLs memories.sourceChatId pointing at it.
 * - NULLs scheduledTasks.lastRunChatId pointing at it.
 * - Deletes the chat row.
 */
export function deleteChatWithOrphanCleanup(chatId: string): void {
  // If a run is in flight, cancel it before deleting so subscribers see the cancel event
  const run = getRunByChatId(chatId);
  if (run?.status === 'running') {
    run.abortController.abort();
  }
  evictByChatId(chatId);

  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.chatId, chatId)).run();
    tx.update(memories)
      .set({ sourceChatId: null })
      .where(eq(memories.sourceChatId, chatId))
      .run();
    tx.update(scheduledTasks)
      .set({ lastRunChatId: null })
      .where(eq(scheduledTasks.lastRunChatId, chatId))
      .run();
    tx.delete(chats).where(eq(chats.id, chatId)).run();
  });
}
