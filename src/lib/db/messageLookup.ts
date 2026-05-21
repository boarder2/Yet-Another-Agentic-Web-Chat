import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface MessageLookupRow {
  messageId: number;
  content: string;
  role: 'assistant' | 'user' | 'compaction' | null;
  metadata: unknown;
  createdAt: string | null;
  chatId: string;
  chatTitle: string | null;
  chatWorkspaceId: string | null;
  isPrivate: number | null;
}

export type MessageLookupResult =
  | { ok: true; row: MessageLookupRow }
  | {
      ok: false;
      reason: 'not_found' | 'private' | 'compaction' | 'wrong_workspace';
    };

export function getMessageById(
  messageId: number,
  opts: { workspaceId?: string | null } = {},
): MessageLookupResult {
  const row = db
    .select({
      content: messages.content,
      role: messages.role,
      metadata: messages.metadata,
      chatId: messages.chatId,
      chatTitle: chats.title,
      chatWorkspaceId: chats.workspaceId,
      isPrivate: chats.isPrivate,
    })
    .from(messages)
    .leftJoin(chats, eq(chats.id, messages.chatId))
    .where(eq(messages.id, messageId))
    .get();

  if (!row) return { ok: false, reason: 'not_found' };

  if (opts.workspaceId !== undefined) {
    const expected = opts.workspaceId ?? null;
    const actual = row.chatWorkspaceId ?? null;
    if (expected !== actual) return { ok: false, reason: 'wrong_workspace' };
  }

  if (row.isPrivate === 1) return { ok: false, reason: 'private' };
  if (row.role === 'compaction') return { ok: false, reason: 'compaction' };

  let createdAt: string | null = null;
  if (row.metadata && typeof row.metadata === 'object') {
    const meta = row.metadata as Record<string, unknown>;
    if (typeof meta.createdAt === 'string') createdAt = meta.createdAt;
  }

  return {
    ok: true,
    row: {
      messageId,
      content: row.content,
      role: row.role,
      metadata: row.metadata,
      createdAt,
      chatId: row.chatId,
      chatTitle: row.chatTitle,
      chatWorkspaceId: row.chatWorkspaceId,
      isPrivate: row.isPrivate,
    },
  };
}
