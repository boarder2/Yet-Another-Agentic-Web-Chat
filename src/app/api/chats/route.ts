import db from '@/lib/db';
import {
  chats as chatsTable,
  messages as messagesTable,
} from '@/lib/db/schema';
import { desc, eq, sql, and, isNull, isNotNull } from 'drizzle-orm';
import {
  buildWorkspaceCondition,
  getMessageCounts,
  hydrateSearchHits,
  searchChatsByKeywords,
} from '@/lib/db/chatSearch';

export const GET = async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const q = searchParams.get('q')?.trim() || '';
    const pinnedParam = searchParams.get('pinned');
    const scheduledParam = searchParams.get('scheduled');
    const workspaceIdParam = searchParams.get('workspaceId');
    const workspaceIdsParam = searchParams.get('workspaceIds');

    const parsedLimit = parseInt(limitParam ?? '50', 10);
    const parsedOffset = parseInt(offsetParam ?? '0', 10);
    const limit = isNaN(parsedLimit)
      ? 50
      : Math.min(Math.max(parsedLimit, 1), 50);
    const offset = isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);

    if (q) {
      const workspaceIds = workspaceIdsParam
        ? workspaceIdsParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      // Upper bound on the matched-chat window we score in one pass.
      const SEARCH_CAP = 500;
      const hits = await searchChatsByKeywords({
        keywords: [q],
        workspaceId: workspaceIdParam ?? undefined,
        workspaceIds,
        includePrivate: true,
        includeCompaction: true,
        limit: SEARCH_CAP,
      });

      const { chats: matched, totalMessages } = await hydrateSearchHits(
        hits,
        q,
      );

      // Paginate only when the caller explicitly asked for a window
      // (limit/offset params). The default flat-list search UI sends neither
      // and expects the full matched set, so return everything (capped) in
      // that case, with offset/limit available for clients that do page.
      const paginated = limitParam !== null || offsetParam !== null;
      const paged = paginated ? matched.slice(offset, offset + limit) : matched;

      return Response.json(
        {
          chats: paged,
          total: matched.length,
          totalMessages,
          ...(paginated ? { limit, offset } : {}),
          hasMore: paginated
            ? offset + paged.length < matched.length
            : matched.length >= SEARCH_CAP,
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
    const workspaceIds = workspaceIdsParam
      ? workspaceIdsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const wsCondition = buildWorkspaceCondition({
      workspaceId: workspaceIdParam ?? undefined,
      workspaceIds,
    });
    if (wsCondition) conditions.push(wsCondition);
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
      .where(and(whereCondition, eq(messagesTable.role, 'user')));
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
