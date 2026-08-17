import { z } from 'zod';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import {
  executeCode,
  checkDockerAvailable,
  ensureImage,
} from '@/lib/sandbox/dockerExecutor';
import { getCodeExecutionConfig } from '@/lib/config';
import { emitStreamEvent } from '@/lib/streaming/events';
import {
  createCodeChartChannel,
  injectChartHelper,
  registerCodeExecutionCharts,
} from './codeExecutionCharts';
import { defineTool } from '@/lib/tools/defineTool';

const MAX_CODE_LENGTH = 50_000;

const CodeExecutionToolSchema = z.object({
  description: z
    .string()
    .max(100)
    .describe('Under 15 words; shown at approval.'),
  code: z
    .string()
    .max(MAX_CODE_LENGTH, 'Code must be 50,000 characters or less.')
    .describe('Node.js JS. Use console.log for output.'),
});

export const codeExecutionTool = defineTool(
  async (input: z.infer<typeof CodeExecutionToolSchema>, runtime) => {
    const { emitter, interactiveSession } = runtime.context;
    const toolCallId = runtime.toolCallId;

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

    // Cheap availability check before user approval
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

    const { code, description } = input;

    // interrupt() pauses the graph until user approves/denies.
    // markupKey enables runHost to resolve the ToolCall markup ID.
    // ensureImage (expensive) runs AFTER approval, on resume.
    const response: unknown = interrupt({
      kind: 'code_execution',
      toolCallId,
      markupKey: code,
      payload: { code, description, createdAt: Date.now() },
      snapshot: null,
    });

    // Cancellation discriminator
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

    const approval = response as { approved: boolean; reason?: string };

    if (!approval.approved) {
      // Surface the denial as a result event so the approval modal resolves on
      // every attached tab (the acting tab already hides via local state).
      emitStreamEvent(emitter, {
        type: 'code_execution_result',
        data: { denied: true, denyReason: approval.reason, toolCallId },
      });

      const denialMessage = approval.reason
        ? `Code execution was denied by the user. User feedback: "${approval.reason}"`
        : 'Code execution was denied by the user.';

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: denialMessage,
              tool_call_id: toolCallId,
            }),
          ],
        },
      });
    }

    // Prepare Docker image (post-approval; expensive — runs only once after approval)
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

    const chartChannel = createCodeChartChannel();
    const result = await executeCode(injectChartHelper(code, chartChannel), {
      privateRecordPrefix: chartChannel.prefix,
    });
    const executionSucceeded =
      result.exitCode === 0 &&
      !result.timedOut &&
      !result.oomKilled &&
      !result.error;
    const chartOutcome = registerCodeExecutionCharts({
      records: result.privateRecords ?? result.machineRecords ?? [],
      recordErrors:
        result.privateRecordErrors ?? result.machineRecordErrors ?? [],
      executionSucceeded,
      registry: runtime.context.chartRegistry,
      emitter,
      toolCallId,
    });
    const cleanedStdout = result.stdout;

    emitStreamEvent(emitter, {
      type: 'code_execution_result',
      data: {
        stdout: cleanedStdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        oomKilled: result.oomKilled,
        toolCallId,
        chartHandles: chartOutcome.handles,
        chartTitles: chartOutcome.titles,
        chartErrors: chartOutcome.errors,
      },
    });

    let resultText = '';
    if (result.timedOut) {
      resultText = `Execution timed out after ${ceConfig.timeoutSeconds} seconds.`;
    } else if (result.oomKilled) {
      resultText = `Execution ran out of memory (limit: ${ceConfig.memoryMb}MB).`;
    } else {
      resultText = `Exit code: ${result.exitCode}`;
      if (cleanedStdout) resultText += `\n\nStdout:\n${cleanedStdout}`;
      if (result.stderr) resultText += `\n\nStderr:\n${result.stderr}`;
    }
    if (chartOutcome.handles.length > 0) {
      resultText += '\n\nCharts:';
      for (let index = 0; index < chartOutcome.handles.length; index += 1) {
        resultText += `\n- ${chartOutcome.handles[index]} — ${chartOutcome.titles[index]}`;
      }
    }
    if (chartOutcome.errors.length > 0) {
      resultText += '\n\nChart errors:';
      for (const error of chartOutcome.errors) resultText += `\n- ${error}`;
    }

    await runtime.persist({
      kind: 'code_execution',
      body: `[code_execution]\nCode:\n${input.code}\n\nResult:\n${resultText}`,
      metadataExtras: { language: 'javascript' },
    });

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
      'Run sandboxed Node.js JS (no network/filesystem, user-approved). Prefer this over reasoning for exact results: math, date/time, counting, regex, encoding, sorting/aggregation, unit conversion. To register a chart from computed data, call the injected global chart(spec) helper; after a successful run, use the returned short handle with show_chart.',
    schema: CodeExecutionToolSchema,
  },
);
