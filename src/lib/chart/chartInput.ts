import { z } from 'zod';
import {
  CHART_MAX_STRING_LEN,
  ChartSpecSchema,
  isCssColor,
  type ChartSpec,
} from './chartSpec';

/** Limits for the compact model-facing chart input. */
export const CHART_INPUT_MAX_LABELS = 100;
export const CHART_INPUT_MAX_SERIES = 15;
export const CHART_INPUT_MAX_SLICES = 20;

/** Stable keys used when a simplified input is normalized to ChartSpec. */
export const CHART_INPUT_X_KEY = 'label';
export const CHART_INPUT_STACK_ID = 'stacked';

const boundedText = z
  .string()
  .max(CHART_MAX_STRING_LEN, 'text must be 500 characters or less');

const requiredText = boundedText.refine((value) => value.trim().length > 0, {
  message: 'text must not be blank',
});

const finiteNumber = z.number().refine((value) => Number.isFinite(value), {
  message: 'number must be finite',
});

const nonNegativeFiniteNumber = finiteNumber.refine((value) => value >= 0, {
  message: 'number must be non-negative',
});

const cssColor = boundedText.refine(
  (value) => isCssColor(value.trim()),
  'color must be a valid CSS color',
);

const labelValue = z.union([requiredText, finiteNumber]);

const cartesianSeries = z
  .object({
    label: requiredText,
    values: z
      .array(finiteNumber)
      .min(1, 'series values must not be empty')
      .max(
        CHART_INPUT_MAX_LABELS,
        `series values must have at most ${CHART_INPUT_MAX_LABELS} entries`,
      ),
    color: cssColor.optional(),
  })
  .strict();

const cartesianOptions = {
  showLegend: z.boolean().optional(),
  showGrid: z.boolean().optional(),
  xLabel: requiredText.optional(),
  yLabel: requiredText.optional(),
  yMin: finiteNumber.optional(),
  yMax: finiteNumber.optional(),
};

const barOptions = z
  .object({
    ...cartesianOptions,
    orientation: z.enum(['vertical', 'horizontal']).optional(),
    stacked: z.boolean().optional(),
  })
  .strict();

const lineOptions = z.object(cartesianOptions).strict();

const areaOptions = z
  .object({
    ...cartesianOptions,
    stacked: z.boolean().optional(),
  })
  .strict();

const pieSlice = z
  .object({
    label: requiredText,
    value: nonNegativeFiniteNumber,
    color: cssColor.optional(),
  })
  .strict();

const pieOptions = z
  .object({
    donut: z.boolean().optional(),
    showLegend: z.boolean().optional(),
  })
  .strict();

function displayedValue(value: string | number): string {
  return typeof value === 'string' ? value.trim() : String(value);
}

function duplicateIndexes(values: readonly (string | number)[]): number[] {
  const seen = new Map<string, number>();
  const duplicates: number[] = [];
  values.forEach((value, index) => {
    const display = displayedValue(value);
    const first = seen.get(display);
    if (first !== undefined) duplicates.push(index);
    else seen.set(display, index);
  });
  return duplicates;
}

function hasInvalidBounds(options?: { yMin?: number; yMax?: number }): boolean {
  return (
    options?.yMin !== undefined &&
    options.yMax !== undefined &&
    options.yMin >= options.yMax
  );
}

type CartesianValidationInput = {
  labels: readonly (string | number)[];
  series: readonly { label: string; values: readonly number[] }[];
  options?: { yMin?: number; yMax?: number };
};

type AddValidationIssue = (issue: {
  code: 'custom';
  path: (string | number)[];
  message: string;
}) => void;

function validateCartesianInput(
  input: CartesianValidationInput,
  addIssue: AddValidationIssue,
): void {
  for (const index of duplicateIndexes(input.labels)) {
    addIssue({
      code: 'custom',
      path: ['labels', index],
      message: 'labels must be unique after trimming',
    });
  }
  for (const index of duplicateIndexes(
    input.series.map((series) => series.label),
  )) {
    addIssue({
      code: 'custom',
      path: ['series', index, 'label'],
      message: 'series labels must be unique after trimming',
    });
  }
  input.series.forEach((series, index) => {
    if (series.values.length !== input.labels.length) {
      addIssue({
        code: 'custom',
        path: ['series', index, 'values'],
        message: `series values must align with labels (${input.labels.length} entries required)`,
      });
    }
  });
  if (hasInvalidBounds(input.options)) {
    addIssue({
      code: 'custom',
      path: ['options'],
      message: 'yMin must be less than yMax',
    });
  }
}

const barInput = z
  .object({
    type: z.literal('bar'),
    title: requiredText,
    labels: z
      .array(labelValue)
      .min(1, 'labels must not be empty')
      .max(
        CHART_INPUT_MAX_LABELS,
        `at most ${CHART_INPUT_MAX_LABELS} labels are allowed`,
      ),
    series: z
      .array(cartesianSeries)
      .min(1, 'series must not be empty')
      .max(
        CHART_INPUT_MAX_SERIES,
        `at most ${CHART_INPUT_MAX_SERIES} series are allowed`,
      ),
    options: barOptions.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    validateCartesianInput(input, (issue) => ctx.addIssue(issue));
  });

const lineInput = z
  .object({
    type: z.literal('line'),
    title: requiredText,
    labels: z
      .array(labelValue)
      .min(1, 'labels must not be empty')
      .max(
        CHART_INPUT_MAX_LABELS,
        `at most ${CHART_INPUT_MAX_LABELS} labels are allowed`,
      ),
    series: z
      .array(cartesianSeries)
      .min(1, 'series must not be empty')
      .max(
        CHART_INPUT_MAX_SERIES,
        `at most ${CHART_INPUT_MAX_SERIES} series are allowed`,
      ),
    options: lineOptions.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    validateCartesianInput(input, (issue) => ctx.addIssue(issue));
  });

const areaInput = z
  .object({
    type: z.literal('area'),
    title: requiredText,
    labels: z
      .array(labelValue)
      .min(1, 'labels must not be empty')
      .max(
        CHART_INPUT_MAX_LABELS,
        `at most ${CHART_INPUT_MAX_LABELS} labels are allowed`,
      ),
    series: z
      .array(cartesianSeries)
      .min(1, 'series must not be empty')
      .max(
        CHART_INPUT_MAX_SERIES,
        `at most ${CHART_INPUT_MAX_SERIES} series are allowed`,
      ),
    options: areaOptions.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    validateCartesianInput(input, (issue) => ctx.addIssue(issue));
  });

const pieInput = z
  .object({
    type: z.literal('pie'),
    title: requiredText,
    slices: z
      .array(pieSlice)
      .min(1, 'slices must not be empty')
      .max(
        CHART_INPUT_MAX_SLICES,
        `at most ${CHART_INPUT_MAX_SLICES} slices are allowed`,
      ),
    options: pieOptions.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    for (const index of duplicateIndexes(
      input.slices.map((slice) => slice.label),
    )) {
      ctx.addIssue({
        code: 'custom',
        path: ['slices', index, 'label'],
        message: 'slice labels must be unique after trimming',
      });
    }
    const total = input.slices.reduce((sum, slice) => sum + slice.value, 0);
    if (!Number.isFinite(total) || total <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['slices'],
        message: 'pie slice values must have a positive total',
      });
    }
  });

export const ChartInputSchema = z
  .discriminatedUnion('type', [barInput, lineInput, areaInput, pieInput])
  .describe(
    'Simplified chart input: Cartesian charts use labels and aligned series values; pie charts use labeled non-negative slices.',
  );

/** DeepSeek requires every function's root JSON Schema to be an object. */
export const ChartToolInputSchema = z
  .object({
    type: z.enum(['bar', 'line', 'area', 'pie']),
    title: requiredText,
    labels: z
      .array(labelValue)
      .max(CHART_INPUT_MAX_LABELS)
      .optional()
      .describe('Required for bar, line, and area charts.'),
    series: z
      .array(cartesianSeries)
      .max(CHART_INPUT_MAX_SERIES)
      .optional()
      .describe('Required for bar, line, and area charts.'),
    slices: z
      .array(pieSlice)
      .max(CHART_INPUT_MAX_SLICES)
      .optional()
      .describe('Required for pie charts.'),
    options: z
      .object({
        ...cartesianOptions,
        orientation: z.enum(['vertical', 'horizontal']).optional(),
        stacked: z.boolean().optional(),
        donut: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const parsed = ChartInputSchema.safeParse(input);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) =>
        ctx.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        }),
      );
    }
  })
  .describe(
    'Simplified chart input. Cartesian charts require labels and aligned series values; pie charts require labeled non-negative slices.',
  );

type CartesianChartInput = z.infer<
  typeof barInput | typeof lineInput | typeof areaInput
>;
type PieChartInput = z.infer<typeof pieInput>;

function canonicalSeriesKey(index: number): string {
  return `series_${index + 1}`;
}

function normalizeLabel(value: string | number): string | number {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeCartesianOptions(
  input: CartesianChartInput,
): NonNullable<ChartSpec['options']> | undefined {
  const source = input.options;
  if (!source) return undefined;

  const options: NonNullable<ChartSpec['options']> = {};
  if ('orientation' in source && source.orientation !== undefined) {
    options.orientation = source.orientation;
  }
  if (source.showLegend !== undefined) options.showLegend = source.showLegend;
  if (source.showGrid !== undefined) options.showGrid = source.showGrid;
  if (source.xLabel !== undefined) options.xLabel = source.xLabel.trim();
  if (source.yLabel !== undefined) options.yLabel = source.yLabel.trim();
  if (source.yMin !== undefined) options.yMin = source.yMin;
  if (source.yMax !== undefined) options.yMax = source.yMax;

  return Object.keys(options).length > 0 ? options : undefined;
}

function normalizeCartesian(input: CartesianChartInput): ChartSpec {
  const source = input.options;
  const stacked =
    source !== undefined && 'stacked' in source && source.stacked === true;
  const series: ChartSpec['series'] = input.series.map((entry, index) => ({
    key: canonicalSeriesKey(index),
    label: entry.label.trim(),
    ...(entry.color !== undefined ? { color: entry.color.trim() } : {}),
    ...(stacked ? { stackId: CHART_INPUT_STACK_ID } : {}),
  }));

  const data: ChartSpec['data'] = input.labels.map((label, rowIndex) => {
    const row: Record<string, string | number> = {
      [CHART_INPUT_X_KEY]: normalizeLabel(label),
    };
    input.series.forEach((entry, seriesIndex) => {
      row[canonicalSeriesKey(seriesIndex)] = entry.values[rowIndex];
    });
    return row;
  });

  const options = normalizeCartesianOptions(input);
  const spec: ChartSpec = {
    type: input.type,
    title: input.title.trim(),
    data,
    series,
    xKey: CHART_INPUT_X_KEY,
    ...(options ? { options } : {}),
  };

  return ChartSpecSchema.parse(spec);
}

function normalizePie(input: PieChartInput): ChartSpec {
  const data: ChartSpec['data'] = input.slices.map((slice) => ({
    name: slice.label.trim(),
    value: slice.value,
    ...(slice.color !== undefined ? { color: slice.color.trim() } : {}),
  }));
  const options: NonNullable<ChartSpec['options']> = {};
  if (input.options?.donut !== undefined) options.donut = input.options.donut;
  if (input.options?.showLegend !== undefined) {
    options.showLegend = input.options.showLegend;
  }

  const spec: ChartSpec = {
    type: 'pie',
    title: input.title.trim(),
    data,
    series: [{ key: 'value' }],
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };

  return ChartSpecSchema.parse(spec);
}

/** Validate and normalize the simplified model-facing input to ChartSpec. */
export function normalizeChartInput(input: unknown): ChartSpec {
  const parsed = ChartInputSchema.parse(input);
  return parsed.type === 'pie'
    ? normalizePie(parsed)
    : normalizeCartesian(parsed);
}

/** Safe counterpart for callers that need to return validation feedback. */
export function safeNormalizeChartInput(input: unknown) {
  try {
    return { success: true as const, data: normalizeChartInput(input) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false as const, error };
    }
    throw error;
  }
}

/** Flatten a validation failure into one model-readable sentence. */
export function chartValidationMessage(error: {
  issues: Array<{ message: string }>;
}): string {
  return error.issues.map((issue) => issue.message).join('; ');
}
