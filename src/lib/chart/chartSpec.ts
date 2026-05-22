import { z } from 'zod';

const isCssColor = (val: string) =>
  /^#([0-9a-fA-F]{3,8})$/.test(val) ||
  /^rgba?\(/.test(val) ||
  /^hsla?\(/.test(val) ||
  /^[a-zA-Z]+$/.test(val);

export const ChartSeriesSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  color: z
    .string()
    .refine(isCssColor, { message: 'color must be a valid CSS color' })
    .optional(),
  stackId: z.string().optional(),
});

export const ChartOptionsSchema = z
  .object({
    orientation: z.enum(['vertical', 'horizontal']).optional(),
    donut: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    showGrid: z.boolean().optional(),
    yLabel: z.string().optional(),
    xLabel: z.string().optional(),
  })
  .optional();

export const ChartSpecSchema = z
  .object({
    type: z.enum(['bar', 'line', 'pie', 'area']),
    title: z.string().optional(),
    data: z
      .array(z.record(z.string(), z.union([z.string(), z.number()])))
      .min(1, 'data must have at least one row'),
    series: z
      .array(ChartSeriesSchema)
      .min(1, 'series must have at least one entry'),
    xKey: z.string().optional(),
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
