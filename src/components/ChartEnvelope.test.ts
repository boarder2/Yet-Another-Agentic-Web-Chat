import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeChartInput } from '@/lib/chart/chartInput';
import { ChartSpecContext } from '@/lib/chart/ChartSpecContext';

const { chartWidget } = vi.hoisted(() => ({
  chartWidget: vi.fn(() => null),
}));

vi.mock('./ChartWidget', () => ({ default: chartWidget }));

import ChartEnvelope from './ChartEnvelope';
import ChartElement, { spaceChartTags } from './ChartElement';

const spec = normalizeChartInput({
  type: 'line',
  title: 'Revenue',
  labels: ['Jan'],
  series: [{ label: 'Sales', values: [1] }],
});

function renderEnvelope(
  chartId: string,
  value: ComponentProps<typeof ChartSpecContext.Provider>['value'],
): string {
  return renderToStaticMarkup(
    createElement(
      ChartSpecContext.Provider,
      { value },
      createElement(ChartEnvelope, { chartId }),
    ),
  );
}

describe('ChartEnvelope', () => {
  beforeEach(() => {
    chartWidget.mockClear();
  });

  it('resolves the private canonical id and renders the chart widget', () => {
    const markup = renderEnvelope('private-1', {
      getChartSpec: () => undefined,
      getChartSpecById: (id) => (id === 'private-1' ? spec : undefined),
    });

    expect(markup).toBe('');
    expect(chartWidget).toHaveBeenCalledWith({ spec }, undefined);
  });

  it('does not use legacy title lookup for a writer-owned envelope', () => {
    const markup = renderEnvelope('Revenue', {
      // Historical `<Chart id="…"/>` rendering may use this compatibility
      // lookup, but a yaawc:chart payload must require its private id.
      getChartSpec: (id) => (id === 'Revenue' ? spec : undefined),
    });

    expect(markup).toBe('');
    expect(chartWidget).not.toHaveBeenCalled();
  });

  it('does not fall back when exact lookup misses an id', () => {
    const markup = renderEnvelope('Revenue', {
      getChartSpec: () => spec,
      getChartSpecById: () => undefined,
    });

    expect(markup).toBe('');
    expect(chartWidget).not.toHaveBeenCalled();
  });

  it('keeps the historical Chart element lookup and block spacing path', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ChartSpecContext.Provider,
        {
          value: {
            getChartSpec: (id) => (id === 'legacy-id' ? spec : undefined),
          },
        },
        createElement(ChartElement, { id: 'legacy-id' }),
      ),
    );

    expect(markup).toBe('');
    expect(chartWidget).toHaveBeenCalledWith({ spec }, undefined);
    expect(spaceChartTags('Answer <Chart id="legacy-id"/> now')).toBe(
      'Answer \n\n<Chart id="legacy-id"/>\n\n now',
    );
  });
});
