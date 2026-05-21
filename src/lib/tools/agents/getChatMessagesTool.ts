import { tool } from '@langchain/core/tools';
import { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { getMessageById } from '@/lib/db/messageLookup';

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

      const result = getMessageById(input.messageId, {
        workspaceId: workspaceId ?? null,
      });
      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            return `No message found with id ${input.messageId}.`;
          case 'wrong_workspace':
            return `Message ${input.messageId} is not accessible from the current workspace.`;
          case 'private':
            return `Message ${input.messageId} belongs to a private chat and cannot be retrieved.`;
          case 'compaction':
            return `Message ${input.messageId} is a compaction summary and cannot be retrieved.`;
        }
      }

      return `## Message ${input.messageId} from "${result.row.chatTitle || result.row.chatId}"\n\n**${result.row.role}**: ${result.row.content}`;
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
