import { z } from 'zod';
import { emitStreamEvent } from '@/lib/streaming/events';
import { TurnChartRegistryError } from '@/lib/chart/turnChartRegistry';
import { defineTool } from '@/lib/tools/defineTool';

const ShowChartToolSchema = z
  .object({
    handle: z
      .string()
      .min(1, 'chart handle must not be blank')
      .describe('The short chart handle returned by create_chart or chart().'),
  })
  .strict();

export const showChartTool = defineTool(
  async (
    input: z.infer<typeof ShowChartToolSchema>,
    runtime,
  ): Promise<string> => {
    const { chartRegistry, emitter } = runtime.context;

    const snapshot = chartRegistry.snapshot();
    let placement;
    try {
      placement = chartRegistry.place(input.handle);
    } catch (error) {
      if (error instanceof TurnChartRegistryError)
        return `Error: ${error.message}`;
      return `Error: Could not show chart: ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
      emitStreamEvent(emitter, {
        type: 'chart_placement',
        data: {
          placementId: placement.placementId,
          chartId: placement.chartId,
          handle: placement.handle,
          placementNumber: placement.placementNumber,
        },
      });
    } catch (error) {
      chartRegistry.restore(snapshot);
      console.warn(
        'showChartTool: Failed to emit chart placement event',
        error,
      );
      return 'Error: Failed to emit chart placement event; the chart was not shown. Try show_chart again.';
    }

    return JSON.stringify({
      handle: placement.handle,
      title: placement.title,
    });
  },
  {
    name: 'show_chart',
    description:
      'Display a chart created during this turn at this point in the answer. Pass only a handle returned by create_chart or chart(spec); do not write a Chart tag or use an internal ID. A chart can be shown more than once.',
    schema: ShowChartToolSchema,
  },
);

export { ShowChartToolSchema };
