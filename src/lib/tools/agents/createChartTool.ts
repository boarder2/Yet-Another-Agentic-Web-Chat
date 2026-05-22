import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import crypto from 'crypto';
import { ChartSpecSchema } from '@/lib/chart/chartSpec';

export const createChartTool = tool(
  async (
    input: z.infer<typeof ChartSpecSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const emitter = config?.configurable?.emitter;

    const validation = ChartSpecSchema.safeParse(input);
    if (!validation.success) {
      const msg = validation.error.issues.map((i) => i.message).join('; ');
      return `Error: Invalid chart spec — ${msg}. Please fix and retry.`;
    }

    if (!emitter) {
      return 'Error: create_chart requires an interactive session. It is unavailable in subagents and non-streaming contexts.';
    }

    const spec = validation.data;
    const chartId = crypto.randomUUID();

    try {
      emitter.emit(
        'data',
        JSON.stringify({
          type: 'chart_spec',
          data: { chartId, spec },
        }),
      );
    } catch (err) {
      console.warn('createChartTool: Failed to emit chart_spec event', err);
      return 'Error: Failed to emit chart spec event.';
    }

    return JSON.stringify({ chartId });
  },
  {
    name: 'create_chart',
    description:
      'Generate an interactive chart (bar, line, pie/donut, area). Call the tool, then place <Chart id="<chartId>"/> exactly where the chart should appear in your response.',
    schema: ChartSpecSchema,
  },
);
