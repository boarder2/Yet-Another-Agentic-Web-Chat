import {
  BaseMessage,
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { removeThinkingBlocks, removeToolCallMarkup } from './contentStripping';

export { removeThinkingBlocks, removeToolCallMarkup };

/**
 * Prepares an array of BaseMessage history entries for replay to the LLM by
 * stripping UI-only artifacts: <think> blocks and <ToolCall> markup tags.
 * @param messages Array of BaseMessage objects
 * @returns New array with UI artifacts removed from each message's content
 */
export const prepHistoryMessages = (messages: BaseMessage[]): BaseMessage[] => {
  return messages.map((message) => {
    // Only process string content, leave complex content as-is
    if (typeof message.content !== 'string') {
      return message;
    }

    const cleanedContent = removeToolCallMarkup(
      removeThinkingBlocks(message.content),
    );

    // Create new instance of the same message type with cleaned content
    if (message instanceof AIMessage) {
      return new AIMessage(cleanedContent);
    } else if (message instanceof HumanMessage) {
      return new HumanMessage(cleanedContent);
    } else if (message instanceof SystemMessage) {
      return new SystemMessage(cleanedContent);
    } else if (message instanceof ToolMessage) {
      return new ToolMessage({
        content: cleanedContent,
        tool_call_id: message.tool_call_id,
      });
    } else {
      // For any other message types, return the original message unchanged
      // This is a safe fallback for custom message types
      return message;
    }
  });
};
