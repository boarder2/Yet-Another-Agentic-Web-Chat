import {
  TURN_CHART_MAX_PLACEMENTS,
  TURN_CHART_MAX_REGISTRATIONS,
} from '@/lib/chart/turnChartRegistry';

/**
 * Chart guidance shared by focus modes that expose the chart lifecycle tools.
 * The model-facing contract is deliberately smaller than the historical
 * renderer-facing ChartSpec.
 */
export function buildChartingGuidance(codeExecutionEnabled: boolean): string {
  const registrationPath = codeExecutionEnabled
    ? 'create_chart or code chart(spec)'
    : 'create_chart';
  const firstStep = codeExecutionEnabled
    ? 'Call \`create_chart\` for hand-authored data, or call \`chart(spec)\` inside \`code_execution\` for computed data.'
    : 'Call \`create_chart\` for hand-authored data.';
  const codePath = codeExecutionEnabled
    ? `
### Computed data
Use \`code_execution\` when the values need aggregation, sorting, parsing, or other exact computation. The sandbox provides a global \`chart(spec)\` helper:

\`\`\`js
const totals = [
  { label: 'Q1', value: 120 },
  { label: 'Q2', value: 150 },
];
chart({
  type: 'bar',
  title: 'Quarterly totals',
  labels: totals.map((row) => row.label),
  series: [{ label: 'Total', values: totals.map((row) => row.value) }],
});
\`\`\`

Call \`chart(spec)\` once per computed chart; it returns nothing, and the handles come back in the tool result. Registration is silent — after a successful execution, call \`show_chart\` with each handle that belongs in the answer, or the reader sees no chart. Invalid emissions are reported independently; failed, timed-out, or out-of-memory executions register none.`
    : '';

  return `## Charts & Graphs

Use charts when numeric comparisons, trends, or part-to-whole proportions are clearer visually. A chart is turn-local: ${registrationPath} registers it, and only \`show_chart\` displays it.

### The short workflow
1. ${firstStep}
2. Read the returned short handle (for example, \`chart_1\`) and title.
3. Call \`show_chart({ handle: "chart_1" })\` exactly where the chart belongs. A chart may be shown repeatedly.

Never invent a handle, use an internal chart ID, author HTML, or write a \`<Chart>\` tag. A handle or tool name typed into the answer (\`{chart_1}\`, a bare \`show_chart\` line) is stripped from the answer — only the tool call places a chart. A chart that is never shown stays invisible. If a handle is rejected, use the available current-turn handles in the tool feedback or create a new chart. The built-in \`chart-creation\` skill is optional reference material; it is not required before the first chart.

### Simplified input
Cartesian \`bar\`, \`line\`, and \`area\` charts use aligned labels and series:

\`\`\`json
{
  "type": "bar | line | area",
  "title": "Required title",
  "labels": ["Jan", "Feb", "Mar"],
  "series": [
    { "label": "Sales", "values": [12, 15, 14], "color": "#4f46e5" }
  ],
  "options": {
    "orientation": "horizontal",
    "stacked": false,
    "showLegend": true,
    "showGrid": true,
    "xLabel": "Month",
    "yLabel": "Units",
    "yMin": 0,
    "yMax": 20
  }
}
\`\`\`

Pie charts use unique, non-negative slices with a positive total:

\`\`\`json
{
  "type": "pie",
  "title": "Share",
  "slices": [
    { "label": "A", "value": 60, "color": "#4f46e5" },
    { "label": "B", "value": 40, "color": "#14b8a6" }
  ],
  "options": { "donut": true, "showLegend": true }
}
\`\`\`

Titles and labels are trimmed; displayed labels must be unique (including numeric/string collisions). Values must be finite numbers. Limits are 100 labels, 15 Cartesian series, and 20 pie slices. Colors are optional valid CSS colors. Only applicable options are accepted; when both bounds are supplied, \`yMin\` must be less than \`yMax\`.

One turn can register at most ${TURN_CHART_MAX_REGISTRATIONS} charts and call \`show_chart\` at most ${TURN_CHART_MAX_PLACEMENTS} times. Past either cap the call fails and reports the handles you already have, so register only the charts the answer needs.

**When to use:** bar for categories, line for ordered trends, area for magnitude or meaningful stacked composition, and pie/donut for a small part-to-whole breakdown. Avoid charts for tiny tables or single values.${codePath}

Do not duplicate a shown chart's data as a table. Explain the important takeaway in prose after placing the chart.`;
}
