import { tool } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { extractExcerpt, searchChatsByKeywords } from '@/lib/db/chatSearch';

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

      const results = await searchChatsByKeywords({
        keywords: input.keywords,
        workspaceId: workspaceId ?? null,
        excludeChatId: currentChatId,
        after: input.after,
        before: input.before,
        limit: input.limit,
      });

      if (results.length === 0) {
        return `No prior chats found matching keywords: ${input.keywords.join(', ')}.`;
      }

      let output = `Found ${results.length} match${results.length === 1 ? '' : 'es'} for keywords [${input.keywords.join(', ')}]:\n`;

      for (const row of results) {
        const chatDate = new Date(row.chatCreatedAt).toISOString().slice(0, 10);

        let messageDate: string | null = null;
        if (row.messageCreatedAt) {
          const parsed = Date.parse(row.messageCreatedAt);
          if (!isNaN(parsed)) {
            messageDate = new Date(parsed).toISOString().slice(0, 10);
          }
        }

        output += `\n### ${row.chatTitle || '(untitled)'}\n`;
        output += `- chatId: \`${row.chatId}\`\n`;
        output += `- chatDate: ${chatDate}\n`;
        output += `- score: ${row.score}\n`;
        output += `- matchedKeywords: ${row.matchedKeywords.length ? row.matchedKeywords.join(', ') : '(none)'}\n`;

        if (row.messageContent && row.messageId !== null) {
          output += `- messageId: \`${row.messageId}\`\n`;
          output += `- messageDate: ${messageDate ?? chatDate}\n`;
          output += `- role: ${row.messageRole ?? 'unknown'}\n`;
          output += `> ${extractExcerpt(row.messageContent, input.keywords, { radius: 150, ellipsis: '...' })}\n`;
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
