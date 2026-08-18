import { z } from 'zod';
import {
  ChartToolInputSchema,
  chartValidationMessage,
  safeNormalizeChartInput,
} from '@/lib/chart/chartInput';
import { emitStreamEvent } from '@/lib/streaming/events';
import { defineTool } from '@/lib/tools/defineTool';

export const createChartTool = defineTool(
  async (
    input: z.infer<typeof ChartToolInputSchema>,
    runtime,
  ): Promise<string> => {
    const { chartRegistry, emitter } = runtime.context;

    const normalized = safeNormalizeChartInput(input);
    if (!normalized.success) {
      return `Error: Invalid chart input — ${chartValidationMessage(normalized.error)}. Please fix and retry.`;
    }

    const snapshot = chartRegistry.snapshot();
    try {
      const registration = chartRegistry.register(normalized.data);
      emitStreamEvent(emitter, {
        type: 'chart_spec',
        data: {
          chartId: registration.chartId,
          handle: registration.handle,
          spec: registration.spec,
          source: 'create_chart',
          toolCallId: runtime.toolCallId,
        },
      });
      return JSON.stringify({
        handle: registration.handle,
        title: registration.title,
        // Registration is silent, and models routinely stop here and describe a
        // chart the reader cannot see. The next step rides back with the handle.
        next_step: `This chart is not visible yet. Call show_chart({ handle: "${registration.handle}" }) at the point in your answer where it belongs.`,
      });
    } catch (error) {
      chartRegistry.restore(snapshot);
      console.warn('createChartTool: Failed to register chart', error);
      return `Error: Could not create chart — ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'create_chart',
    description:
      'Register an interactive bar, line, area, or pie chart for this turn. Use the simplified input with a title, labels and aligned series values (or pie slices). The result contains a short handle; call show_chart with that handle where the chart should appear. This tool registers only and never writes response markup.',
    schema: ChartToolInputSchema,
  },
);
