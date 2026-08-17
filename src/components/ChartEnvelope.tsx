'use client';

import ChartWidget from './ChartWidget';
import { useChartSpecById } from '@/lib/chart/ChartSpecContext';

/** Renders a writer-owned chart placement by its private canonical chart id. */
const ChartEnvelope = ({ chartId }: { chartId: string }) => {
  const spec = useChartSpecById(chartId);
  return spec ? <ChartWidget spec={spec} /> : null;
};

export default ChartEnvelope;
