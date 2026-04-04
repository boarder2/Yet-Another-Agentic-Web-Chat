import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import crypto from 'crypto';
import { isSoftStop } from '@/lib/utils/runControl';
import { waitForApproval } from '@/lib/sandbox/pendingApprovals';
import { popCallbackRunId } from '@/lib/sandbox/codeExecutionCorrelation';
import {
  executeCode,
  checkDockerAvailable,
  ensureImage,
} from '@/lib/sandbox/dockerExecutor';
import { getCodeExecutionConfig } from '@/lib/config';

const MAX_CODE_LENGTH = 50_000;

const CodeExecutionToolSchema = z.object({
  description: z
    .string()
    .max(100)
    .describe(
      'A brief plain-text summary (under 15 words) of what this code does, shown to the user during approval.',
    ),
  code: z
    .string()
    .max(MAX_CODE_LENGTH, 'Code must be 50,000 characters or less.')
    .describe(
      'JavaScript code to execute in a sandboxed Node.js environment. ' +
        'The code runs in an isolated Docker container with no network access and no filesystem persistence. ' +
        'Use console.log() for output. The user must approve execution before it runs.',
    ),
});

export const codeExecutionTool = tool(
  async (
    input: z.infer<typeof CodeExecutionToolSchema>,
    config?: RunnableConfig,
  ) => {
    const messageId = config?.configurable?.messageId;
    const emitter = config?.configurable?.emitter;
    const interactiveSession =
      config?.configurable?.interactiveSession === true;
    const toolCallId =
      (config as unknown as { toolCall?: { id?: string } })?.toolCall?.id ??
      'code_execution';

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
                'Code execution requires a top-level interactive session with user approval. It is unavailable in subagents and non-streaming contexts.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    const ceConfig = getCodeExecutionConfig();

    if (!ceConfig.enabled) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content:
                (ceConfig as { validationError?: string }).validationError ||
                'Code execution is disabled in server configuration.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    const dockerOk = await checkDockerAvailable();
    if (!dockerOk) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content:
                'Code execution is unavailable: Docker daemon is not running.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    try {
      await ensureImage(ceConfig.dockerImage);
    } catch (err: unknown) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: `Code execution error: failed to prepare Docker image "${ceConfig.dockerImage}": ${err instanceof Error ? err.message : String(err)}`,
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    const executionId = crypto.randomUUID();
    const { code, description } = input;

    // Get the callback runId that corresponds to the ToolCall markup's toolCallId.
    // This is needed because parallel code_execution tools may emit pending events
    // in a different order than handleToolStart fired (due to async Docker checks).
    const markupToolCallId = popCallbackRunId(code);

    emitter.emit(
      'data',
      JSON.stringify({
        type: 'code_execution_pending',
        data: { executionId, code, description, toolCallId, markupToolCallId },
      }),
    );

    const { approved } = await waitForApproval(
      executionId,
      5 * 60 * 1000,
      messageId,
    );

    if (!approved) {
      emitter.emit(
        'data',
        JSON.stringify({
          type: 'code_execution_result',
          data: { executionId, denied: true, toolCallId },
        }),
      );

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Code execution was denied by the user.',
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    const result = await executeCode(code);

    emitter.emit(
      'data',
      JSON.stringify({
        type: 'code_execution_result',
        data: {
          executionId,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          oomKilled: result.oomKilled,
          toolCallId,
        },
      }),
    );

    let resultText = '';
    if (result.timedOut) {
      resultText = `Execution timed out after ${ceConfig.timeoutSeconds} seconds.`;
    } else if (result.oomKilled) {
      resultText = `Execution ran out of memory (limit: ${ceConfig.memoryMb}MB).`;
    } else {
      resultText = `Exit code: ${result.exitCode}`;
      if (result.stdout) resultText += `\n\nStdout:\n${result.stdout}`;
      if (result.stderr) resultText += `\n\nStderr:\n${result.stderr}`;
    }

    return new Command({
      update: {
        messages: [
          new ToolMessage({
            content: resultText,
            tool_call_id: toolCallId,
          }),
        ],
      },
    });
  },
  {
    name: 'code_execution',
    description:
      'Execute JavaScript code in a secure, sandboxed Node.js environment. ' +
      'The code runs in an isolated Docker container with no network access and strict resource limits. ' +
      'The user must approve the code before it executes. Use this for calculations, data processing, ' +
      'generating outputs, or testing code snippets. Use console.log() to produce output.',
    schema: CodeExecutionToolSchema,
  },
);
