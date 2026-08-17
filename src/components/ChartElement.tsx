import ChartWidget from './ChartWidget';
import { useChartSpec } from '@/lib/chart/ChartSpecContext';
import { Card } from '@/components/ui/Card';

/**
 * Legacy resolver for historical chat rows and dashboard-generated
 * `<Chart id="…"/>` placeholders. New chat model output must use the
 * `show_chart` lifecycle, whose writer-owned `yaawc:chart` envelope is rendered
 * by ChartEnvelope.
 */
const ChartElement = ({ id }: { id?: string }) => {
  const spec = useChartSpec(id ?? '');
  if (!id) return null;
  if (!spec) {
    return (
      <Card className="my-3 px-4 py-3 text-sm text-fg-muted italic">
        Loading chart…
      </Card>
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
