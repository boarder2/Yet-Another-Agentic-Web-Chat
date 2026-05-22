'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartSpec, ChartSpecSchema } from '@/lib/chart/chartSpec';

// Design-system-compatible series palette.
// These are Tailwind CSS variables from the YAAWC design system.
// Using accent and semantic colors in a cycle.
const SERIES_PALETTE = [
  'var(--color-blue-500)',
  'var(--color-emerald-500)',
  'var(--color-amber-500)',
  'var(--color-rose-500)',
  'var(--color-violet-500)',
  'var(--color-cyan-500)',
  'var(--color-orange-500)',
  'var(--color-teal-500)',
];

function getSeriesColor(index: number, override?: string): string {
  if (override) return override;
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

interface ChartWidgetProps {
  spec: ChartSpec;
}

function ChartWidgetInner({ spec }: ChartWidgetProps) {
  const { type, data, series, xKey = 'x', options = {} } = spec;
  const {
    orientation = 'vertical',
    donut = false,
    showLegend = true,
    showGrid = type !== 'pie',
    yLabel,
    xLabel,
  } = options;

  const commonProps = {
    data,
    margin: { top: 8, right: 16, left: 8, bottom: yLabel ? 24 : 8 },
  };

  const axisStyle = {
    fontSize: 11,
    fill: 'var(--color-fg)',
    opacity: 0.6,
  };

  const tooltipStyle = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-surface-2)',
    borderRadius: '6px',
    color: 'var(--color-fg)',
    fontSize: 12,
  };

  const gridStroke = 'var(--color-surface-2)';

  const renderLegend = showLegend && series.length > 1;

  if (type === 'pie') {
    const outerR = donut ? '70%' : '80%';
    const innerR = donut ? '45%' : '0%';
    return (
      <ResponsiveContainer width="100%" minHeight={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey={series[0].key}
            nameKey="name"
            outerRadius={outerR}
            innerRadius={innerR}
            paddingAngle={2}
          >
            {data.map((_, idx) => (
              <Cell
                key={idx}
                fill={getSeriesColor(idx, series[0]?.color)}
                opacity={0.9}
              />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'bar') {
    const isHorizontal = orientation === 'horizontal';
    return (
      <ResponsiveContainer width="100%" minHeight={280}>
        <BarChart
          {...commonProps}
          layout={isHorizontal ? 'vertical' : 'horizontal'}
        >
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          )}
          {isHorizontal ? (
            <>
              <XAxis
                type="number"
                tick={axisStyle}
                label={
                  xLabel
                    ? {
                        value: xLabel,
                        position: 'insideBottom',
                        offset: -10,
                        style: axisStyle,
                      }
                    : undefined
                }
              />
              <YAxis
                type="category"
                dataKey={xKey}
                tick={axisStyle}
                width={80}
                label={
                  yLabel
                    ? {
                        value: yLabel,
                        angle: -90,
                        position: 'insideLeft',
                        style: axisStyle,
                      }
                    : undefined
                }
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={xKey}
                tick={axisStyle}
                label={
                  xLabel
                    ? {
                        value: xLabel,
                        position: 'insideBottom',
                        offset: -10,
                        style: axisStyle,
                      }
                    : undefined
                }
              />
              <YAxis
                tick={axisStyle}
                label={
                  yLabel
                    ? {
                        value: yLabel,
                        angle: -90,
                        position: 'insideLeft',
                        style: axisStyle,
                      }
                    : undefined
                }
              />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} />
          {renderLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label ?? s.key}
              fill={getSeriesColor(i, s.color)}
              stackId={s.stackId}
              radius={[2, 2, 0, 0]}
              opacity={0.9}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'line') {
    return (
      <ResponsiveContainer width="100%" minHeight={280}>
        <LineChart {...commonProps}>
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          )}
          <XAxis
            dataKey={xKey}
            tick={axisStyle}
            label={
              xLabel
                ? {
                    value: xLabel,
                    position: 'insideBottom',
                    offset: -10,
                    style: axisStyle,
                  }
                : undefined
            }
          />
          <YAxis
            tick={axisStyle}
            label={
              yLabel
                ? {
                    value: yLabel,
                    angle: -90,
                    position: 'insideLeft',
                    style: axisStyle,
                  }
                : undefined
            }
          />
          <Tooltip contentStyle={tooltipStyle} />
          {renderLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={getSeriesColor(i, s.color)}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // type === 'area'
  return (
    <ResponsiveContainer width="100%" minHeight={280}>
      <AreaChart {...commonProps}>
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
        )}
        <XAxis
          dataKey={xKey}
          tick={axisStyle}
          label={
            xLabel
              ? {
                  value: xLabel,
                  position: 'insideBottom',
                  offset: -10,
                  style: axisStyle,
                }
              : undefined
          }
        />
        <YAxis
          tick={axisStyle}
          label={
            yLabel
              ? {
                  value: yLabel,
                  angle: -90,
                  position: 'insideLeft',
                  style: axisStyle,
                }
              : undefined
          }
        />
        <Tooltip contentStyle={tooltipStyle} />
        {renderLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => {
          const color = getSeriesColor(i, s.color);
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={color}
              fill={color}
              fillOpacity={0.2}
              strokeWidth={2}
              stackId={s.stackId}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function ChartWidget({ spec }: ChartWidgetProps) {
  const validation = useMemo(() => ChartSpecSchema.safeParse(spec), [spec]);

  if (!validation.success) {
    const reason = validation.error.issues.map((i) => i.message).join('; ');
    return (
      <div className="my-3 bg-danger-soft border border-danger rounded-surface px-4 py-3 text-sm text-danger">
        Could not render chart: {reason}
      </div>
    );
  }

  const validSpec = validation.data;

  return (
    <div className="my-3 bg-surface border border-surface-2 rounded-surface overflow-hidden">
      {validSpec.title && (
        <div className="px-4 pt-3 pb-1 text-sm font-semibold text-fg">
          {validSpec.title}
        </div>
      )}
      <div className="px-2 py-3">
        <ChartWidgetInner spec={validSpec} />
      </div>
    </div>
  );
}
