import ChartWidget from './ChartWidget';
import { useChartSpec } from '@/lib/chart/ChartSpecContext';

/**
 * Resolves a `<Chart id="…"/>` placement against the specs streamed for the
 * message. Shared by the message body and the agent panel's executor columns.
 */
const ChartElement = ({ id }: { id?: string }) => {
  const spec = useChartSpec(id ?? '');
  if (!id) return null;
  if (!spec) {
    return (
      <div className="my-3 bg-surface border border-surface-2 rounded-surface px-4 py-3 text-sm text-fg/60 italic">
        Loading chart…
      </div>
    );
  }
  return <ChartWidget spec={spec} />;
};

/**
 * Put `<Chart id="…"/>` placements on their own block. markdown-to-jsx treats an
 * unspaced custom element as inline and wraps the chart's <div> in a <p>, which
 * is invalid nesting and blows up hydration.
 */
export const spaceChartTags = (text: string): string =>
  text.replace(/(<Chart\b[^>]*\/>)/g, '\n\n$1\n\n');

export default ChartElement;
