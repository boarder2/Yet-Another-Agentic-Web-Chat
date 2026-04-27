import db from '@/lib/db';
import {
  chats as chatsTable,
  messages as messagesTable,
} from '@/lib/db/schema';
import {
  desc,
  eq,
  sql,
  like,
  or,
  and,
  inArray,
  isNull,
  isNotNull,
} from 'drizzle-orm';

async function getMessageCounts(
  chatIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (chatIds.length === 0) return counts;
  const rows = await db
    .select({
      chatId: messagesTable.chatId,
      count: sql<number>`count(*)`,
    })
    .from(messagesTable)
    .where(inArray(messagesTable.chatId, chatIds))
    .groupBy(messagesTable.chatId);
  for (const r of rows) counts.set(r.chatId, Number(r.count));
  return counts;
}

function extractExcerpt(
  content: string,
  term: string,
  contextLen = 80,
): string {
  const lowerContent = content.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const idx = lowerContent.indexOf(lowerTerm);

  if (idx === -1) {
    const max = contextLen * 2;
    return content.length > max
      ? content.slice(0, max).trim() + '…'
      : content.trim();
  }

  const start = Math.max(0, idx - contextLen);
  const end = Math.min(content.length, idx + term.length + contextLen);

  let excerpt = content.slice(start, end).trim();
  if (start > 0) excerpt = '…' + excerpt;
  if (end < content.length) excerpt = excerpt + '…';

  return excerpt;
}

export const GET = async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const q = searchParams.get('q')?.trim() || '';
    const pinnedParam = searchParams.get('pinned');
    const scheduledParam = searchParams.get('scheduled');

    const parsedLimit = parseInt(limitParam ?? '50', 10);
    const parsedOffset = parseInt(offsetParam ?? '0', 10);
    const limit = isNaN(parsedLimit)
      ? 50
      : Math.min(Math.max(parsedLimit, 1), 50);
    const offset = isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);

    if (q) {
      const searchPattern = `%${q}%`;

      // Fetch matching messages with content so we can build excerpts
      const matchingMessages = await db
        .select({
          chatId: messagesTable.chatId,
          content: messagesTable.content,
        })
        .from(messagesTable)
        .where(like(messagesTable.content, searchPattern));

      // First match per chatId → excerpt
      const chatIdToExcerpt = new Map<string, string>();
      for (const msg of matchingMessages) {
        if (!chatIdToExcerpt.has(msg.chatId)) {
          chatIdToExcerpt.set(msg.chatId, extractExcerpt(msg.content, q));
        }
      }

      const matchingChatIds = Array.from(chatIdToExcerpt.keys());

      const whereCondition =
        matchingChatIds.length > 0
          ? or(
              like(chatsTable.title, searchPattern),
              inArray(chatsTable.id, matchingChatIds),
            )
          : like(chatsTable.title, searchPattern);

      const rows = await db
        .select()
        .from(chatsTable)
        .where(whereCondition)
        .orderBy(desc(sql`rowid`));

      const messageCounts = await getMessageCounts(rows.map((r) => r.id));
      const chats = rows.map((chat) => ({
        ...chat,
        matchExcerpt: chatIdToExcerpt.get(chat.id) ?? null,
        messageCount: messageCounts.get(chat.id) ?? 0,
      }));

      const totalMessages = chats.reduce((sum, c) => sum + c.messageCount, 0);

      return Response.json(
        {
          chats,
          total: chats.length,
          totalMessages,
          hasMore: false,
        },
        { status: 200 },
      );
    }

    const conditions = [];
    if (pinnedParam === '1') conditions.push(eq(chatsTable.pinned, 1));
    if (scheduledParam === '1')
      conditions.push(isNotNull(chatsTable.scheduledTaskId));
    else if (scheduledParam === '0')
      conditions.push(isNull(chatsTable.scheduledTaskId));
    const whereCondition =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(chatsTable)
      .where(whereCondition);
    const total = Number(totalRows?.[0]?.count ?? 0);

    const totalMessagesRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(messagesTable)
      .innerJoin(chatsTable, eq(messagesTable.chatId, chatsTable.id))
      .where(whereCondition);
    const totalMessages = Number(totalMessagesRows?.[0]?.count ?? 0);

    const rows = await db
      .select()
      .from(chatsTable)
      .where(whereCondition)
      .orderBy(desc(sql`rowid`))
      .limit(limit)
      .offset(offset);

    const messageCounts = await getMessageCounts(rows.map((r) => r.id));
    const chatsWithCounts = rows.map((chat) => ({
      ...chat,
      messageCount: messageCounts.get(chat.id) ?? 0,
    }));

    return Response.json(
      {
        chats: chatsWithCounts,
        total,
        totalMessages,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
