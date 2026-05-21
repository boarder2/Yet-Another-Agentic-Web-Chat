import { tool } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import {
  and,
  or,
  eq,
  ne,
  isNull,
  like,
  desc,
  sql,
  gte,
  lte,
} from 'drizzle-orm';

const schema = z.object({
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .max(8)
    .describe(
      'List of keywords or short phrases to search for (case-insensitive substrings). Provide several related terms and synonyms — results are scored by how many keywords match, so broader coverage ranks better. For "that trip we discussed" try ["trip","travel","vacation","flight","hotel"]. For "the bug from last month" try ["bug","error","crash","exception"].',
    ),
  after: z
    .string()
    .optional()
    .describe(
      'Optional ISO date (YYYY-MM-DD). Only include chats created on or after this date.',
    ),
  before: z
    .string()
    .optional()
    .describe(
      'Optional ISO date (YYYY-MM-DD). Only include chats created on or before this date.',
    ),
  limit: z.number().int().min(1).max(20).optional().default(10),
});

function makeSnippet(
  content: string,
  keywords: string[],
  radius = 150,
): string {
  const lower = content.toLowerCase();
  let firstIdx = -1;
  let firstLen = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const idx = lower.indexOf(k);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
      firstLen = k.length;
    }
  }
  if (firstIdx === -1) {
    return content.length > radius * 2
      ? content.slice(0, radius * 2).trim() + '...'
      : content.trim();
  }
  const start = Math.max(0, firstIdx - radius);
  const end = Math.min(content.length, firstIdx + firstLen + radius);
  let s = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = '...' + s;
  if (end < content.length) s = s + '...';
  return s;
}

function matchedKeywords(
  content: string,
  title: string | null,
  keywords: string[],
): string[] {
  const c = content.toLowerCase();
  const t = (title ?? '').toLowerCase();
  return keywords.filter((kw) => {
    const k = kw.toLowerCase();
    return c.includes(k) || t.includes(k);
  });
}

export const chatHistorySearchTool = tool(
  async (
    input: {
      keywords: string[];
      after?: string;
      before?: string;
      limit: number;
    },
    config?: RunnableConfig,
  ): Promise<string> => {
    try {
      const configurable = config?.configurable ?? {};
      const workspaceId: string | undefined = configurable.workspaceId;
      const currentChatId: string | undefined = configurable.chatId;

      const workspaceCond = workspaceId
        ? eq(chats.workspaceId, workspaceId)
        : isNull(chats.workspaceId);

      const patterns = input.keywords.map(
        (kw) =>
          '%' +
          kw.replace(/%/g, '\\%').replace(/_/g, '\\_').toLowerCase() +
          '%',
      );

      // Score: +1 per keyword found in message content, +2 per keyword found in chat title
      const contentScoreParts = patterns.map(
        (p) =>
          sql`(CASE WHEN lower(${messages.content}) LIKE ${p} THEN 1 ELSE 0 END)`,
      );
      const titleScoreParts = patterns.map(
        (p) =>
          sql`(CASE WHEN lower(${chats.title}) LIKE ${p} THEN 2 ELSE 0 END)`,
      );
      const scoreExpr = sql.join(
        [...contentScoreParts, ...titleScoreParts],
        sql` + `,
      );

      // Match condition: ANY keyword hits title or content
      const anyMatchParts = patterns.flatMap((p) => [
        like(sql`lower(${messages.content})`, p),
        like(sql`lower(${chats.title})`, p),
      ]);

      const conditions = [
        workspaceCond,
        or(isNull(chats.isPrivate), eq(chats.isPrivate, 0)),
        or(isNull(messages.role), ne(messages.role, 'compaction')),
        or(...anyMatchParts),
      ];

      if (currentChatId) {
        conditions.splice(1, 0, ne(chats.id, currentChatId));
      }

      if (input.after) {
        const t = Date.parse(input.after);
        if (!isNaN(t)) conditions.push(gte(chats.createdAt, t));
      }
      if (input.before) {
        const t = Date.parse(input.before);
        // Include the entire "before" day
        if (!isNaN(t)) conditions.push(lte(chats.createdAt, t + 86_400_000));
      }

      const rows = await db
        .select({
          chatId: chats.id,
          chatTitle: chats.title,
          chatCreatedAt: chats.createdAt,
          messageId: messages.id,
          messageRole: messages.role,
          content: messages.content,
          messageCreatedAt: sql<
            string | null
          >`json_extract(${messages.metadata}, '$.createdAt')`,
          score: sql<number>`(${scoreExpr})`.as('score'),
        })
        .from(chats)
        .leftJoin(messages, eq(messages.chatId, chats.id))
        .where(and(...conditions))
        .orderBy(
          desc(sql`score`),
          desc(chats.createdAt),
          sql`${messages.id} DESC NULLS LAST`,
        )
        .limit(input.limit * 4);

      // Dedupe to highest-scoring message per chat (rows already score-sorted)
      const seen = new Set<string>();
      const results: typeof rows = [];
      for (const row of rows) {
        if (!seen.has(row.chatId)) {
          seen.add(row.chatId);
          results.push(row);
          if (results.length >= input.limit) break;
        }
      }

      if (results.length === 0) {
        return `No prior chats found matching keywords: ${input.keywords.join(', ')}.`;
      }

      let output = `Found ${results.length} match${results.length === 1 ? '' : 'es'} for keywords [${input.keywords.join(', ')}]:\n`;

      for (const row of results) {
        const chatDate = row.chatCreatedAt
          ? new Date(row.chatCreatedAt).toISOString().slice(0, 10)
          : 'unknown';

        let messageDate: string | null = null;
        if (row.messageCreatedAt) {
          const parsed = Date.parse(row.messageCreatedAt);
          if (!isNaN(parsed)) {
            messageDate = new Date(parsed).toISOString().slice(0, 10);
          }
        }

        const matched = matchedKeywords(
          row.content ?? '',
          row.chatTitle,
          input.keywords,
        );

        output += `\n### ${row.chatTitle || '(untitled)'}\n`;
        output += `- chatId: \`${row.chatId}\`\n`;
        output += `- chatDate: ${chatDate}\n`;
        output += `- score: ${row.score}\n`;
        output += `- matchedKeywords: ${matched.length ? matched.join(', ') : '(none)'}\n`;

        if (row.content) {
          output += `- messageId: \`${row.messageId}\`\n`;
          output += `- messageDate: ${messageDate ?? chatDate}\n`;
          output += `- role: ${row.messageRole ?? 'unknown'}\n`;
          output += `> ${makeSnippet(row.content, input.keywords)}\n`;
        } else {
          output += `- (title match only)\n`;
        }
      }

      return output;
    } catch (error) {
      console.error('chat_history_search tool error:', error);
      return 'Error: Failed to search chat history.';
    }
  },
  {
    name: 'chat_history_search',
    description:
      "Search the user's previous conversations by keyword. Provide multiple related keywords and synonyms in the `keywords` array — results are ranked by how many keywords match (title matches weighted higher than content matches). For vague references like \"that trip we discussed\" or \"the bug from last month\", supply diverse terms covering possible wordings: ['trip','travel','vacation','flight','hotel'] or ['bug','error','crash','exception']. Optionally restrict by date with `after`/`before` (YYYY-MM-DD). Each result includes a score, the keywords that matched, the chat date, and the message date. Pass `messageId` to `get_message` for full message content. Excludes the current chat, private chats, and compaction summaries.",
    schema,
  },
);
