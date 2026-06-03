import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { ToolMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import { isSoftStop } from '@/lib/utils/runControl';
import {
  executeCode,
  checkDockerAvailable,
  ensureImage,
} from '@/lib/sandbox/dockerExecutor';
import { getCodeExecutionConfig } from '@/lib/config';
import { ChartSpecSchema } from '@/lib/chart/chartSpec';
import { persistFromToolConfig } from '@/lib/utils/persistToolContext';

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
      emitter.emit(
        'data',
        JSON.stringify({
          type: 'code_execution_result',
          data: { denied: true, denyReason: approval.reason, toolCallId },
        }),
      );

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

    const result = await executeCode(code);

    // Scan stdout for __CHART__ envelopes and extract chart specs
    let cleanedStdout = result.stdout;
    const chartIds: string[] = [];
    const { randomUUID } = await import('crypto');
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
        const chartId = randomUUID();
        chartIds.push(chartId);
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
          stdout: cleanedStdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          oomKilled: result.oomKilled,
          toolCallId,
          chartIds,
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

    await persistFromToolConfig({
      config,
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
      'Run sandboxed Node.js JS (no network/filesystem, user-approved). Prefer this over reasoning for exact results: math, date/time, counting, regex, encoding, sorting/aggregation, unit conversion. Before first use this session, call read_skill("code-execution") for runtime details, sandbox limits, and output patterns.',
    schema: CodeExecutionToolSchema,
  },
);
