import type { ChartSpec } from './chartSpec';
import type { ChartPayload } from '@/lib/widgets/envelope';

/**
 * Resolve a placement event against the turn's known chart specs. Returns the
 * writer widget payload, or `null` when the event is incomplete or names a
 * chart this turn never registered — every consumer (live stream, resume
 * replay, headless run, client reducer) must drop those identically.
 */
export function resolveChartPlacement(
  specs: Record<string, ChartSpec>,
  data: { placementId?: string; chartId?: string },
): ChartPayload | null {
  const { placementId, chartId } = data;
  if (!placementId || !chartId || !specs[chartId]) return null;
  return { id: placementId, chartId };
}
