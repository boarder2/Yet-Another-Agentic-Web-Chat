import { tool } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { extractExcerpt, searchChatsByKeywords } from '@/lib/db/chatSearch';
import { persistFromToolConfig } from '@/lib/utils/persistToolContext';

const schema = z.object({
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .max(8)
    .describe(
      'Substrings to match; include synonyms — more matches rank higher.',
    ),
  after: z.string().optional().describe('ISO date YYYY-MM-DD lower bound.'),
  before: z.string().optional().describe('ISO date YYYY-MM-DD upper bound.'),
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

      await persistFromToolConfig({
        config,
        kind: 'chat_history_search',
        body: output,
        metadataExtras: { query: input.keywords.join(' ') },
      });

      return output;
    } catch (error) {
      console.error('chat_history_search tool error:', error);
      return 'Error: Failed to search chat history.';
    }
  },
  {
    name: 'chat_history_search',
    description:
      'Search prior chats by keyword. Returns ranked matches with messageId — pass to get_message for full text. Excludes current/private chats.',
    schema,
  },
);
