import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeChartInput } from '@/lib/chart/chartInput';

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; props: Record<string, unknown> }>,
}));

type MockProps = Record<string, unknown> & { children?: ReactNode };

vi.mock('recharts', () => {
  const mockComponent = (name: string) => {
    const MockComponent = (props: MockProps) => {
      calls.push({ name, props });
      return createElement('div', null, props.children);
    };
    MockComponent.displayName = `Mock${name}`;
    return MockComponent;
  };

  return {
    Area: mockComponent('Area'),
    AreaChart: mockComponent('AreaChart'),
    Bar: mockComponent('Bar'),
    BarChart: mockComponent('BarChart'),
    CartesianGrid: mockComponent('CartesianGrid'),
    Cell: mockComponent('Cell'),
    Legend: mockComponent('Legend'),
    Line: mockComponent('Line'),
    LineChart: mockComponent('LineChart'),
    Pie: mockComponent('Pie'),
    PieChart: mockComponent('PieChart'),
    ResponsiveContainer: mockComponent('ResponsiveContainer'),
    Tooltip: mockComponent('Tooltip'),
    XAxis: mockComponent('XAxis'),
    YAxis: mockComponent('YAxis'),
  };
});

import ChartWidget from './ChartWidget';

describe('ChartWidget chart-specific rendering props', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('passes normalized area y bounds to the Y axis domain', () => {
    const spec = normalizeChartInput({
      type: 'area',
      title: 'Bounded area',
      labels: ['A', 'B'],
      series: [{ label: 'Value', values: [20, 80] }],
      options: { yMin: 0, yMax: 100 },
    });

    renderToStaticMarkup(createElement(ChartWidget, { spec }));

    const yAxis = calls.find((call) => call.name === 'YAxis');
    expect(yAxis?.props.domain).toEqual([0, 100]);
  });

  it('uses each normalized pie slice color instead of one series color', () => {
    const spec = normalizeChartInput({
      type: 'pie',
      title: 'Colored slices',
      slices: [
        { label: 'First', value: 1, color: '#123456' },
        { label: 'Second', value: 2, color: 'rgb(1, 2, 3)' },
      ],
    });

    renderToStaticMarkup(createElement(ChartWidget, { spec }));

    expect(
      calls
        .filter((call) => call.name === 'Cell')
        .map((call) => call.props.fill),
    ).toEqual(['#123456', 'rgb(1, 2, 3)']);
  });
});
