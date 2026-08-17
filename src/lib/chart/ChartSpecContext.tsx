'use client';

import { createContext, useContext } from 'react';
import { ChartSpec } from './chartSpec';

interface ChartSpecContextValue {
  /** Legacy `<Chart>` and dashboard lookup, which may apply compatibility rules. */
  getChartSpec: (chartId: string) => ChartSpec | undefined;
  /** Exact lookup used by writer-owned chat chart envelopes. */
  getChartSpecById?: (chartId: string) => ChartSpec | undefined;
}

export const ChartSpecContext = createContext<ChartSpecContextValue>({
  getChartSpec: () => undefined,
});

export const useChartSpec = (chartId: string): ChartSpec | undefined => {
  const ctx = useContext(ChartSpecContext);
  return ctx.getChartSpec(chartId);
};

export const useChartSpecById = (chartId: string): ChartSpec | undefined => {
  const ctx = useContext(ChartSpecContext);
  return ctx.getChartSpecById?.(chartId);
};
