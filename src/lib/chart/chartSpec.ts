import { z } from 'zod';

const isCssColor = (val: string) =>
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
    val,
  ) ||
  /^(rgba?|hsla?|oklch|oklab|color|hwb|lab|lch)\([^)]*\)$/.test(val) ||
  /^var\(--[a-zA-Z0-9_-]+(\s*,[^)]*)?\)$/.test(val) ||
  /^[a-zA-Z]+$/.test(val);

// Size caps bound DB bloat + client DoS for code-widget-generated specs.
export const CHART_MAX_DATA_ROWS = 1000;
export const CHART_MAX_SERIES = 20;
export const CHART_MAX_STRING_LEN = 500;
export const CHART_MAX_PER_WIDGET = 10;

const cappedString = z.string().max(CHART_MAX_STRING_LEN);

export const ChartSeriesSchema = z.object({
  key: cappedString.min(1),
  label: cappedString.optional(),
  color: z
    .string()
    .refine(isCssColor, { message: 'color must be a valid CSS color' })
    .optional(),
  stackId: cappedString.optional(),
});

export const ChartOptionsSchema = z
  .object({
    orientation: z.enum(['vertical', 'horizontal']).optional(),
    donut: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    showGrid: z.boolean().optional(),
    yLabel: z.string().optional(),
    xLabel: z.string().optional(),
    yMin: z.number().optional(),
    yMax: z.number().optional(),
  })
  .optional();

export const ChartSpecSchema = z
  .object({
    type: z.enum(['bar', 'line', 'pie', 'area']),
    title: cappedString.optional(),
    data: z
      .array(z.record(z.string(), z.union([cappedString, z.number()])))
      .min(1, 'data must have at least one row')
      .max(
        CHART_MAX_DATA_ROWS,
        `data must have at most ${CHART_MAX_DATA_ROWS} rows`,
      ),
    series: z
      .array(ChartSeriesSchema)
      .min(1, 'series must have at least one entry')
      .max(CHART_MAX_SERIES, `at most ${CHART_MAX_SERIES} series allowed`),
    xKey: cappedString.optional(),
    options: ChartOptionsSchema,
  })
  .superRefine((spec, ctx) => {
    const effectiveXKey = spec.xKey ?? 'x';

    if (spec.type === 'pie') {
      if (spec.series.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'pie charts must have exactly one series',
        });
      }
      for (let i = 0; i < spec.data.length; i++) {
        if (!('name' in spec.data[i])) {
          ctx.addIssue({
            code: 'custom',
            message: `pie chart data row ${i} is missing required 'name' field`,
          });
        }
      }
    } else {
      for (let i = 0; i < spec.data.length; i++) {
        if (!(effectiveXKey in spec.data[i])) {
          ctx.addIssue({
            code: 'custom',
            message: `data row ${i} is missing xKey '${effectiveXKey}'`,
          });
        }
      }
    }

    for (const s of spec.series) {
      for (let i = 0; i < spec.data.length; i++) {
        if (!(s.key in spec.data[i])) {
          ctx.addIssue({
            code: 'custom',
            message: `data row ${i} is missing series key '${s.key}'`,
          });
        }
      }
    }
  });

export type ChartType = 'bar' | 'line' | 'pie' | 'area';
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
