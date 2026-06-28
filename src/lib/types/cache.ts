// Cache-related types
import type { ChartSpec } from '@/lib/chart/chartSpec';

export interface WidgetCache {
  [widgetId: string]: {
    content: string;
    lastFetched: Date;
    expiresAt: Date;
    charts?: Record<string, ChartSpec>;
  };
}
