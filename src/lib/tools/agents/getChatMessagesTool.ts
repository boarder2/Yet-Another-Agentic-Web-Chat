import { tool } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const schema = z.object({
  messageId: z.coerce
    .number()
    .int()
    .describe('The messageId returned by chat_history_search.'),
});

export const getChatMessagesTool = tool(
  async (
    input: { messageId: number },
    config?: RunnableConfig,
  ): Promise<string> => {
    try {
      const configurable = config?.configurable ?? {};
      const workspaceId: string | undefined = configurable.workspaceId;

      const row = db
        .select({
          content: messages.content,
          role: messages.role,
          chatId: messages.chatId,
          isPrivate: chats.isPrivate,
          chatTitle: chats.title,
          chatWorkspaceId: chats.workspaceId,
        })
        .from(messages)
        .leftJoin(chats, eq(chats.id, messages.chatId))
        .where(eq(messages.id, input.messageId))
        .get();

      if (!row) {
        return `No message found with id ${input.messageId}.`;
      }

      if ((row.chatWorkspaceId ?? null) !== (workspaceId ?? null)) {
        return `Message ${input.messageId} is not accessible from the current workspace.`;
      }

      if (row.isPrivate === 1) {
        return `Message ${input.messageId} belongs to a private chat and cannot be retrieved.`;
      }

      if (row.role === 'compaction') {
        return `Message ${input.messageId} is a compaction summary and cannot be retrieved.`;
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
      "Retrieve the full content of a single message by its messageId. Always obtain the messageId from chat_history_search first — do not guess or invent message IDs. Use this when the snippet returned by search is truncated or not enough to fully answer the user's question.",
    schema,
  },
);
