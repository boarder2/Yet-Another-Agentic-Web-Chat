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

/** Insert an empty assistant row at run start so partial content survives a refresh. */
export async function insertPartialAssistantRow(
  messageId: string,
  chatId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(messagesSchema)
    .values({
      content: '',
      chatId,
      messageId,
      role: 'assistant',
      metadata: JSON.stringify(metadata),
    })
    .execute();
}

/** Update content and/or metadata on an existing assistant row. */
export async function updateAssistantRow(
  messageId: string,
  {
    content,
    metadata,
  }: { content?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const updates: Partial<{ content: string; metadata: string }> = {};
  if (content !== undefined) updates.content = content;
  if (metadata !== undefined) updates.metadata = JSON.stringify(metadata);
  if (Object.keys(updates).length === 0) return;

  await db
    .update(messagesSchema)
    .set(updates)
    .where(eq(messagesSchema.messageId, messageId))
    .execute();
}
