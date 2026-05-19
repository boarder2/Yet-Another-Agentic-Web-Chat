import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

const schema = z.object({
  messageId: z
    .number()
    .int()
    .describe('The messageId returned by chat_history_search.'),
});

export const getChatMessagesTool = tool(
  async (input: { messageId: number }): Promise<string> => {
    try {
      const row = db
        .select({
          content: messages.content,
          role: messages.role,
          chatId: messages.chatId,
          isPrivate: chats.isPrivate,
          chatTitle: chats.title,
        })
        .from(messages)
        .leftJoin(chats, eq(chats.id, messages.chatId))
        .where(and(eq(messages.id, input.messageId)))
        .get();

      if (!row) {
        return `No message found with id ${input.messageId}.`;
      }

      if (row.isPrivate === 1) {
        return `Message ${input.messageId} belongs to a private chat and cannot be retrieved.`;
      }

      return `## Message ${input.messageId} from "${row.chatTitle || row.chatId}"\n\n**${row.role}**: ${row.content}`;
    } catch (error) {
      console.error('get_message tool error:', error);
      return 'Error: Failed to retrieve message.';
    }
  },
  {
    name: 'get_message',
    description:
      "Retrieve the full content of a single message by its messageId (obtained from chat_history_search). Use when the snippet from search isn't enough to answer the user's question.",
    schema,
  },
);
