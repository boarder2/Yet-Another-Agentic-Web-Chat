import db, { sqlite } from '@/lib/db';
import { chats, messages, memories, schedules } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { evictByChatId, getRunByChatId } from '@/lib/runs/runHub';
import { deleteCheckpoint } from '@/lib/runs/checkpointer';
import { deleteForChat as deleteHistoryForChat } from '@/lib/history/service';

/**
 * Delete a chat and clean up references atomically.
 * - Deletes all messages for the chat.
 * - NULLs memories.sourceChatId pointing at it.
 * - NULLs schedules.lastRunChatId pointing at it.
 * - Deletes the chat row.
 * - Deletes chat-scoped history and detaches workspace-owned history.
 */
export function deleteChatWithOrphanCleanup(chatId: string): void {
  // If a run is in flight, cancel it before deleting so subscribers see the cancel event
  const run = getRunByChatId(chatId);
  if (run?.status === 'running') {
    run.abortController.abort();
  }

  // Resolve the LangGraph checkpoint thread id before the row is gone. For an
  // evicted awaiting_user run the in-memory Run is absent, so fall back to the
  // persisted column via a synchronous read.
  let threadId: string | undefined = run?.threadId;
  if (!threadId) {
    const row = sqlite
      .prepare('SELECT active_run_thread_id AS t FROM chats WHERE id = ?')
      .get(chatId) as { t?: string | null } | undefined;
    threadId = row?.t ?? undefined;
  }

  evictByChatId(chatId);

  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.chatId, chatId)).run();
    tx.update(memories)
      .set({ sourceChatId: null })
      .where(eq(memories.sourceChatId, chatId))
      .run();
    tx.update(schedules)
      .set({ lastRunChatId: null })
      .where(eq(schedules.lastRunChatId, chatId))
      .run();
    // approval_requests + run_events cascade via ON DELETE CASCADE.
    tx.delete(chats).where(eq(chats.id, chatId)).run();
  });

  deleteHistoryForChat(chatId);

  if (threadId) {
    deleteCheckpoint(threadId).catch((e: unknown) =>
      console.warn('[deleteChat] checkpoint cleanup failed:', e),
    );
  }
}
