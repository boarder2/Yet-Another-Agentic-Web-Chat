import { tool } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { and, or, eq, ne, isNull, like, desc, sql } from 'drizzle-orm';

const schema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Substring to search for in past chat titles and message content (case-insensitive).',
    ),
  limit: z.number().int().min(1).max(20).optional().default(10),
});

function makeSnippet(content: string, q: string, radius = 150): string {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) {
    return content.length > radius * 2
      ? content.slice(0, radius * 2).trim() + '...'
      : content.trim();
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + q.length + radius);
  let s = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = '...' + s;
  if (end < content.length) s = s + '...';
  return s;
}

export const chatHistorySearchTool = tool(
  async (
    input: { query: string; limit: number },
    config?: RunnableConfig,
  ): Promise<string> => {
    try {
      const configurable = config?.configurable ?? {};
      const workspaceId: string | undefined = configurable.workspaceId;
      const currentChatId: string | undefined = configurable.chatId;

      const workspaceCond = workspaceId
        ? eq(chats.workspaceId, workspaceId)
        : isNull(chats.workspaceId);

      const escaped = input.query.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = '%' + escaped.toLowerCase() + '%';

      const conditions = [
        workspaceCond,
        or(isNull(chats.isPrivate), eq(chats.isPrivate, 0)),
        or(isNull(messages.role), ne(messages.role, 'compaction')),
        or(
          like(sql`lower(${messages.content})`, pattern),
          like(sql`lower(${chats.title})`, pattern),
        ),
      ];

      if (currentChatId) {
        conditions.splice(1, 0, ne(chats.id, currentChatId));
      }

      const rows = await db
        .select({
          chatId: chats.id,
          chatTitle: chats.title,
          chatCreatedAt: chats.createdAt,
          messageId: messages.id,
          messageRole: messages.role,
          content: messages.content,
        })
        .from(chats)
        .leftJoin(messages, eq(messages.chatId, chats.id))
        .where(and(...conditions))
        .orderBy(desc(chats.createdAt), desc(messages.id))
        .limit(input.limit * 4);

      // Dedupe to first hit per chatId, cap at limit
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
        return `No prior chats found matching "${input.query}".`;
      }

      let output = `Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${input.query}":\n`;

      for (const row of results) {
        const date = row.chatCreatedAt
          ? new Date(
              typeof row.chatCreatedAt === 'number'
                ? row.chatCreatedAt
                : row.chatCreatedAt,
            )
              .toISOString()
              .slice(0, 10)
          : 'unknown';

        output += `\n### ${row.chatTitle || '(untitled)'}\n`;
        output += `- chatId: \`${row.chatId}\`\n`;
        output += `- date: ${date}\n`;

        if (row.content) {
          output += `- messageId: \`${row.messageId}\`\n`;
          output += `- role: ${row.messageRole ?? 'unknown'}\n`;
          output += `> ${makeSnippet(row.content, input.query)}\n`;
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
      "Search the user's previous conversations (titles and message content) by substring. Use when the user references something discussed before, or you need context from past chats. Excludes the current chat, private chats, and compaction summaries. Each result includes a messageId that can be passed to get_message to retrieve the full message content. IMPORTANT: this is keyword search, not semantic search — it matches exact substrings case-insensitively. Tips for best results: (1) use short, distinctive keywords rather than full sentences; (2) if the first search returns nothing useful, retry with synonyms or alternative phrasings the user might have used; (3) for multi-word concepts, try each word separately before combining them; (4) prefer nouns and domain-specific terms over common words.",
    schema,
  },
);
