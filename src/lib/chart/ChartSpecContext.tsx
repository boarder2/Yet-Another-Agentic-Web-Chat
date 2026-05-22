'use client';

import { createContext, useContext } from 'react';
import { ChartSpec } from './chartSpec';

interface ChartSpecContextValue {
  getChartSpec: (chartId: string) => ChartSpec | undefined;
}

export const ChartSpecContext = createContext<ChartSpecContextValue>({
  getChartSpec: () => undefined,
});

export const useChartSpec = (chartId: string): ChartSpec | undefined => {
  const ctx = useContext(ChartSpecContext);
  return ctx.getChartSpec(chartId);
};
