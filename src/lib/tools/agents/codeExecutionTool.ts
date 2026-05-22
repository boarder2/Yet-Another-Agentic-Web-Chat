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
import { ChartSpecSchema } from '@/lib/chart/chartSpec';

const CHART_ENVELOPE_RE = /^__CHART__(\{.*\})$/;

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

    // Scan stdout for __CHART__ envelopes and extract chart specs
    let cleanedStdout = result.stdout;
    if (result.stdout) {
      const lines = result.stdout.split('\n');
      const processedLines: string[] = [];
      for (const line of lines) {
        const m = line.trim().match(CHART_ENVELOPE_RE);
        if (!m) {
          processedLines.push(line);
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(m[1]);
        } catch {
          // Malformed JSON — leave line untouched
          processedLines.push(line);
          continue;
        }
        const validation = ChartSpecSchema.safeParse(parsed);
        if (!validation.success) {
          const reason = validation.error.issues
            .map((i) => i.message)
            .join('; ');
          processedLines.push(`Chart skipped: ${reason}`);
          continue;
        }
        const chartId = crypto.randomUUID();
        const chartTitle = validation.data.title;
        processedLines.push(
          `[Chart created${chartTitle ? ` — title: "${chartTitle}"` : ''}. To display it, copy this tag verbatim into your response where the chart should appear: <Chart id="${chartId}"/>]`,
        );
        try {
          emitter.emit(
            'data',
            JSON.stringify({
              type: 'chart_spec',
              data: {
                chartId,
                spec: validation.data,
                source: 'code_execution',
                toolCallId,
              },
            }),
          );
        } catch (err) {
          console.warn(
            'codeExecutionTool: Failed to emit chart_spec event',
            err,
          );
        }
      }
      cleanedStdout = processedLines.join('\n');
    }

    emitter.emit(
      'data',
      JSON.stringify({
        type: 'code_execution_result',
        data: {
          executionId,
          stdout: cleanedStdout,
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
      if (cleanedStdout) resultText += `\n\nStdout:\n${cleanedStdout}`;
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
      'Run sandboxed Node.js JS (no network/filesystem, user-approved). Prefer this over reasoning for exact results: math, date/time, counting, regex, encoding, sorting/aggregation, unit conversion.',
    schema: CodeExecutionToolSchema,
  },
);
