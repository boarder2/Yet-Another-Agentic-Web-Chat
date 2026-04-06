import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import crypto from 'crypto';
import { isSoftStop } from '@/lib/utils/runControl';
import { waitForUserResponse } from '@/lib/userQuestion/pendingQuestions';
import { popCallbackRunId } from '@/lib/userQuestion/questionCorrelation';

const AskUserToolSchema = z.object({
  question: z
    .string()
    .max(500)
    .describe(
      'The main question to ask the user. Be clear and concise. One question at a time.',
    ),
  options: z
    .array(
      z.object({
        label: z.string().max(100).describe('Display label for this option'),
        description: z
          .string()
          .max(200)
          .optional()
          .describe('Optional secondary description'),
      }),
    )
    .max(10)
    .optional()
    .describe(
      'Optional predefined choices. Must be specific answers to the question. If omitted, only free-form text input is shown.',
    ),
  multiSelect: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Allow the user to select multiple options. Defaults to single-select.',
    ),
  allowFreeformInput: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Allow the user to type a free-form response in addition to options. ' +
        'Defaults to true. The user can always use this to redirect the agent.',
    ),
  context: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Brief context shown to user about why this question is being asked.',
    ),
});

export const askUserTool = tool(
  async (input: z.infer<typeof AskUserToolSchema>, config?: RunnableConfig) => {
    const messageId = config?.configurable?.messageId;
    const emitter = config?.configurable?.emitter;
    const interactiveSession =
      config?.configurable?.interactiveSession === true;
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

    const questionId = crypto.randomUUID();
    const { question, options, multiSelect, allowFreeformInput, context } =
      input;

    // Get the callback runId for ToolCall markup correlation
    const markupToolCallId = popCallbackRunId(question);

    emitter.emit(
      'data',
      JSON.stringify({
        type: 'user_question_pending',
        data: {
          questionId,
          question,
          options,
          multiSelect,
          allowFreeformInput,
          context,
          toolCallId,
          markupToolCallId,
          createdAt: Date.now(),
        },
      }),
    );

    const response = await waitForUserResponse(
      questionId,
      15 * 60 * 1000,
      messageId,
    );

    // Build response text for the agent
    let responseText: string;

    if (response.timedOut) {
      responseText =
        'The user did not respond within the allotted time. Continue with your best judgment.';
    } else if (response.skipped) {
      responseText =
        'The user skipped this question and wants you to decide on your own. Continue with your best judgment.';
    } else {
      const parts: string[] = [];
      if (response.selectedOptions && response.selectedOptions.length > 0) {
        parts.push(`Selected: ${response.selectedOptions.join(', ')}`);
      }
      if (response.freeformText) {
        parts.push(`User response: "${response.freeformText}"`);
      }
      responseText =
        parts.length > 0
          ? `User responded to "${question}":\n${parts.join('\n')}`
          : 'The user submitted an empty response. Continue with your best judgment.';
    }

    // Emit answered event for frontend persistence
    emitter.emit(
      'data',
      JSON.stringify({
        type: 'user_question_answered',
        data: {
          questionId,
          selectedOptions: response.selectedOptions,
          freeformText: response.freeformText,
          skipped: response.skipped,
          timedOut: response.timedOut,
          toolCallId,
        },
      }),
    );

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
      'Ask the user a question and wait for their response. ' +
      'Use this when you need clarification, the user must make a choice between options, ' +
      'or critical information is missing that you cannot reasonably assume. ' +
      'The user can select from predefined options and/or type a free-form response. ' +
      'Ask ONE clear, concise question at a time. ' +
      'Do NOT use this for trivial clarifications you can infer from context.',
    schema: AskUserToolSchema,
  },
);
