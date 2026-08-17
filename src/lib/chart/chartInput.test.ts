import { describe, expect, it } from 'vitest';
import {
  ChartInputSchema,
  CHART_INPUT_MAX_LABELS,
  CHART_INPUT_MAX_SERIES,
  CHART_INPUT_MAX_SLICES,
  normalizeChartInput,
  safeNormalizeChartInput,
} from './chartInput';
import { ChartSpecSchema } from './chartSpec';

const cartesianInput = (overrides: Record<string, unknown> = {}) => ({
  type: 'line',
  title: 'Trend',
  labels: ['A', 'B'],
  series: [{ label: 'Value', values: [1, 2] }],
  ...overrides,
});

const pieInput = (overrides: Record<string, unknown> = {}) => ({
  type: 'pie',
  title: 'Share',
  slices: [
    { label: 'First', value: 2 },
    { label: 'Second', value: 3 },
  ],
  ...overrides,
});

function expectInvalid(input: unknown, message?: string): void {
  const result = safeNormalizeChartInput(input);
  expect(result.success).toBe(false);
  if (!result.success && message) {
    expect(
      result.error.issues.map((issue) => issue.message).join(' '),
    ).toContain(message);
  }
}

describe('simplified chart input normalization', () => {
  it('normalizes Cartesian labels, series keys, options, and colors', () => {
    const spec = normalizeChartInput({
      type: 'bar',
      title: '  Revenue  ',
      labels: [' Jan ', 2025],
      series: [
        { label: ' Sales ', values: [10, 20], color: ' #123456 ' },
        { label: ' Costs ', values: [5, 8] },
      ],
      options: {
        orientation: 'horizontal',
        stacked: true,
        showLegend: false,
        showGrid: true,
        xLabel: ' Month ',
        yLabel: ' USD ',
        yMin: 0,
        yMax: 100,
      },
    });

    expect(spec).toEqual({
      type: 'bar',
      title: 'Revenue',
      data: [
        { label: 'Jan', series_1: 10, series_2: 5 },
        { label: 2025, series_1: 20, series_2: 8 },
      ],
      series: [
        {
          key: 'series_1',
          label: 'Sales',
          color: '#123456',
          stackId: 'stacked',
        },
        { key: 'series_2', label: 'Costs', stackId: 'stacked' },
      ],
      xKey: 'label',
      options: {
        orientation: 'horizontal',
        showLegend: false,
        showGrid: true,
        xLabel: 'Month',
        yLabel: 'USD',
        yMin: 0,
        yMax: 100,
      },
    });
  });

  it.each(['bar', 'line', 'area'] as const)(
    'accepts the %s Cartesian branch',
    (type) => {
      const input = cartesianInput({ type });
      const result = safeNormalizeChartInput(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(type);
        expect(result.data.xKey).toBe('label');
        expect(result.data.data).toHaveLength(2);
      }
    },
  );

  it('accepts area bounds and maps boolean stacking to the canonical stack ID', () => {
    const spec = normalizeChartInput({
      type: 'area',
      title: '  Area ',
      labels: ['A'],
      series: [
        { label: 'One', values: [4] },
        { label: 'Two', values: [6] },
      ],
      options: { stacked: true, yMin: 0, yMax: 10 },
    });

    expect(spec.options).toEqual({ yMin: 0, yMax: 10 });
    expect(spec.series.map((series) => series.stackId)).toEqual([
      'stacked',
      'stacked',
    ]);
  });

  it('normalizes pie slices, trims labels and colors, and preserves pie options', () => {
    const spec = normalizeChartInput({
      type: 'pie',
      title: '  Distribution ',
      slices: [
        { label: ' A ', value: 2, color: ' #abcdef ' },
        { label: ' B ', value: 3, color: 'rgb(1, 2, 3)' },
      ],
      options: { donut: true, showLegend: false },
    });

    expect(spec).toEqual({
      type: 'pie',
      title: 'Distribution',
      data: [
        { name: 'A', value: 2, color: '#abcdef' },
        { name: 'B', value: 3, color: 'rgb(1, 2, 3)' },
      ],
      series: [{ key: 'value' }],
      options: { donut: true, showLegend: false },
    });
  });

  it('requires a non-blank title for every chart branch', () => {
    expectInvalid(
      { ...cartesianInput(), title: '   ' },
      'text must not be blank',
    );
    expectInvalid({ ...pieInput(), title: '' }, 'text must not be blank');
    expectInvalid({ ...cartesianInput(), title: undefined });
  });

  it('rejects misaligned series values', () => {
    expectInvalid(
      cartesianInput({
        labels: ['A', 'B'],
        series: [{ label: 'Value', values: [1] }],
      }),
      'series values must align',
    );
  });

  it('rejects duplicate displayed labels, including numeric/string collisions', () => {
    expectInvalid(
      cartesianInput({ labels: [' Q1 ', 'Q1'] }),
      'labels must be unique after trimming',
    );
    expectInvalid(
      cartesianInput({ labels: [2025, '2025'] }),
      'labels must be unique after trimming',
    );
    expectInvalid(
      cartesianInput({
        series: [
          { label: ' Sales ', values: [1, 2] },
          { label: 'Sales', values: [3, 4] },
        ],
      }),
      'series labels must be unique after trimming',
    );
    expectInvalid(
      pieInput({
        slices: [
          { label: ' A ', value: 1 },
          { label: 'A', value: 2 },
        ],
      }),
      'slice labels must be unique after trimming',
    );
  });

  it('requires string-or-finite-number labels and finite numeric values', () => {
    expectInvalid(cartesianInput({ labels: ['A', true] }));
    expectInvalid(
      cartesianInput({
        series: [{ label: 'Value', values: [1, '2'] }],
      }),
    );
    expectInvalid(
      cartesianInput({
        series: [{ label: 'Value', values: [1, Number.NaN] }],
      }),
    );
    expectInvalid(
      cartesianInput({
        series: [{ label: 'Value', values: [1, Number.POSITIVE_INFINITY] }],
      }),
    );
    expectInvalid(pieInput({ slices: [{ label: 'Only', value: -1 }] }));
    expectInvalid(pieInput({ slices: [{ label: 'Only', value: Number.NaN }] }));
  });

  it('requires pie totals to be positive while allowing zero-valued slices', () => {
    const spec = normalizeChartInput(
      pieInput({
        slices: [
          { label: 'Empty', value: 0 },
          { label: 'Used', value: 1 },
        ],
      }),
    );
    expect(spec.data).toEqual([
      { name: 'Empty', value: 0 },
      { name: 'Used', value: 1 },
    ]);
    expectInvalid(
      pieInput({
        slices: [
          { label: 'A', value: 0 },
          { label: 'B', value: 0 },
        ],
      }),
      'positive total',
    );
  });

  it('requires yMin to be less than yMax when both bounds are present', () => {
    expectInvalid(
      cartesianInput({ options: { yMin: 10, yMax: 10 } }),
      'yMin must be less than yMax',
    );
    expectInvalid(
      cartesianInput({ options: { yMin: 11, yMax: 10 } }),
      'yMin must be less than yMax',
    );
    expectInvalid(cartesianInput({ options: { yMin: Number.NaN, yMax: 10 } }));
    expectInvalid(
      cartesianInput({ options: { yMin: 0, yMax: Number.POSITIVE_INFINITY } }),
    );
    expect(
      normalizeChartInput(cartesianInput({ options: { yMin: 0 } })).options,
    ).toEqual({ yMin: 0 });
    expect(
      normalizeChartInput(cartesianInput({ options: { yMax: 10 } })).options,
    ).toEqual({ yMax: 10 });
  });

  it('validates optional CSS colors and retains the 500-character safety cap', () => {
    const spec = normalizeChartInput({
      type: 'line',
      title: 'Colors',
      labels: ['A'],
      series: [
        { label: 'Hex', values: [1], color: ' #fff ' },
        { label: 'Variable', values: [2], color: ' var(--color-accent) ' },
      ],
    });
    expect(spec.series.map((series) => series.color)).toEqual([
      '#fff',
      'var(--color-accent)',
    ]);

    expectInvalid(
      cartesianInput({
        series: [{ label: 'Value', values: [1, 2], color: 'not-a-color!' }],
      }),
      'color must be a valid CSS color',
    );
    expectInvalid(
      pieInput({
        slices: [
          { label: 'A', value: 1, color: 'not-a-color!' },
          { label: 'B', value: 1 },
        ],
      }),
      'color must be a valid CSS color',
    );
    expectInvalid({
      ...cartesianInput(),
      title: 'a'.repeat(CHART_INPUT_MAX_LABELS + 401),
    });
  });

  it('allows only options applicable to each chart type', () => {
    expectInvalid(cartesianInput({ type: 'line', options: { stacked: true } }));
    expectInvalid(cartesianInput({ type: 'bar', options: { donut: true } }));
    expectInvalid(pieInput({ options: { xLabel: 'not applicable' } }));

    expect(
      ChartInputSchema.safeParse({
        ...cartesianInput({ type: 'area' }),
        options: { stacked: false },
      }).success,
    ).toBe(true);
    expect(ChartInputSchema.safeParse(cartesianInput()).success).toBe(true);
    expect(ChartInputSchema.safeParse(pieInput()).success).toBe(true);
  });

  it('enforces the simplified 100-label, 15-series, and 20-slice limits', () => {
    const labels = Array.from(
      { length: CHART_INPUT_MAX_LABELS },
      (_, i) => `L${i}`,
    );
    const aligned = {
      type: 'line',
      title: 'Many labels',
      labels,
      series: [{ label: 'Value', values: labels.map(() => 1) }],
    };
    expect(safeNormalizeChartInput(aligned).success).toBe(true);
    expectInvalid({
      ...aligned,
      labels: [...labels, 'L100'],
      series: [{ label: 'Value', values: [...labels.map(() => 1), 1] }],
    });

    const series = Array.from({ length: CHART_INPUT_MAX_SERIES }, (_, i) => ({
      label: `S${i}`,
      values: [i],
    }));
    expect(
      safeNormalizeChartInput({
        type: 'bar',
        title: 'Many series',
        labels: ['Only'],
        series,
      }).success,
    ).toBe(true);
    expectInvalid({
      type: 'bar',
      title: 'Too many series',
      labels: ['Only'],
      series: [...series, { label: 'S15', values: [15] }],
    });

    const slices = Array.from({ length: CHART_INPUT_MAX_SLICES }, (_, i) => ({
      label: `Slice ${i}`,
      value: 1,
    }));
    expect(safeNormalizeChartInput({ ...pieInput(), slices }).success).toBe(
      true,
    );
    expectInvalid({
      ...pieInput(),
      slices: [...slices, { label: 'Slice 20', value: 1 }],
    });
  });

  it('leaves the canonical ChartSpec contract available for historical data', () => {
    const historical = {
      type: 'bar',
      data: [{ x: 'Jan', sales: 10 }],
      series: [{ key: 'sales', color: '#123456' }],
    };

    expect(ChartSpecSchema.safeParse(historical).success).toBe(true);
    expect(ChartInputSchema.safeParse(historical).success).toBe(false);
  });
});
