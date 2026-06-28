import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import { isSoftStop } from '@/lib/utils/runControl';

const AskUserToolSchema = z.object({
  question: z.string().max(500).describe('One focused question.'),
  options: z
    .array(
      z.object({
        label: z.string().max(100).describe('Concrete answer choice.'),
        description: z.string().max(200).optional(),
      }),
    )
    .max(10)
    .optional()
    .describe('Suggested answers; omit if freeform suffices.'),
  multiSelect: z.boolean().optional().default(false),
  allowFreeformInput: z
    .boolean()
    .optional()
    .default(true)
    .describe('Allow user to type a custom reply.'),
  context: z
    .string()
    .max(200)
    .optional()
    .describe('Brief reason shown to user for why you are asking.'),
});

export const askUserTool = tool(
  async (input: z.infer<typeof AskUserToolSchema>, config?: RunnableConfig) => {
    const messageId = config?.configurable?.messageId;
    const interactiveSession =
      config?.configurable?.interactiveSession === true;
    const emitter = config?.configurable?.emitter;
    const toolCallId =
      (config as unknown as { toolCall?: { id?: string } })?.toolCall?.id ??
      'ask_user';

    if (messageId && isSoftStop(messageId)) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Operation stopped by user.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    if (!interactiveSession || !emitter) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content:
                'ask_user requires a top-level interactive session. It is unavailable in subagents and non-streaming contexts. Proceed with your best judgment.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    const { question, options, multiSelect, allowFreeformInput, context } =
      input;

    // interrupt() pauses the graph; the agent resumes when the user responds.
    // It throws GraphInterrupt to suspend, which must propagate uncaught.
    // markupKey enables runHost to resolve the ToolCall markup ID.
    const response: unknown = interrupt({
      kind: 'ask_user',
      toolCallId,
      markupKey: question,
      payload: {
        question,
        options,
        multiSelect,
        allowFreeformInput,
        context,
        createdAt: Date.now(),
      },
      snapshot: null,
    });

    // Cancellation discriminator — runHost resumes with {__cancelled: true} on Stop
    if (response && (response as Record<string, unknown>).__cancelled) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Cancelled by user.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    const r = response as {
      selectedOptions?: string[];
      freeformText?: string;
      skipped?: boolean;
    };

    let responseText: string;
    if (r.skipped) {
      responseText =
        'The user skipped this question and wants you to decide on your own. Continue with your best judgment.';
    } else {
      const parts: string[] = [];
      if (r.selectedOptions && r.selectedOptions.length > 0) {
        parts.push(`Selected: ${r.selectedOptions.join(', ')}`);
      }
      if (r.freeformText) {
        parts.push(`User response: "${r.freeformText}"`);
      }
      responseText =
        parts.length > 0
          ? `User responded to "${question}":\n${parts.join('\n')}`
          : 'The user submitted an empty response. Continue with your best judgment.';
    }

    return new Command({
      update: {
        messages: [
          new ToolMessage({
            content: responseText,
            tool_call_id: toolCallId,
          }),
        ],
      },
    });
  },
  {
    name: 'ask_user',
    description:
      'Ask the user one clear question and wait for their reply. Use for missing info you cannot infer; skip for trivial clarifications. Before first use this session, call read_skill("ask-user") for phrasing rules, option formatting, and multi-select guidance.',
    schema: AskUserToolSchema,
  },
);
