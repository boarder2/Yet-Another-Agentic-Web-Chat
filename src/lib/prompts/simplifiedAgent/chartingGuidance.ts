/**
 * Charting guidance injected into agent prompts for focus modes that include create_chart.
 *
 * @param codeExecutionEnabled - Whether the `code_execution` tool is available. When false,
 *   guidance for the `__CHART__` rendering path is omitted entirely.
 */
export function buildChartingGuidance(codeExecutionEnabled: boolean): string {
  const intro = codeExecutionEnabled
    ? `Charts never display on their own. A chart only appears where you place a \`<Chart id="<chartId>"/>\` tag in your prose. There are two ways to create one — both give you back a \`chartId\`, and both require you to place the tag:

1. **\`create_chart\` tool** — pass the chart spec directly. Use this for chart data you already have.
2. **\`code_execution\` with a \`__CHART__\` emission** — emit the spec via \`console.log("__CHART__" + JSON.stringify(spec))\`. The tool's stdout returns a \`[Chart created: id=...]\` line with the \`chartId\`. Use this when computing chart data from a file or large dataset.

Either way, take the returned \`chartId\` and place exactly one \`<Chart id="<chartId>"/>\` tag where the chart should appear.`
    : `Use \`create_chart\` to render interactive charts inline when presenting numeric comparisons, trends, or proportions. The tool does NOT display anything by itself — after calling it, you MUST place a \`<Chart id="<chartId>"/>\` tag exactly where the chart should appear in your prose.`;

  const codeExecutionStyleRule = codeExecutionEnabled
    ? `\n- To chart data computed from a file or large dataset, emit it from \`code_execution\` via \`console.log("__CHART__" + JSON.stringify(spec))\`, then place the returned \`chartId\` in a \`<Chart .../>\` tag (do NOT also call \`create_chart\` for the same data).`
    : '';

  const dontDuplicate = `**Don't duplicate the chart:** Place exactly one \`<Chart .../>\` tag per chart. And once a chart exists, do not restate its data as a table, bullet list, or inline numbers — refer to the chart and call out key takeaways in prose, but don't repeat the underlying values.`;

  const codeExecutionExample = codeExecutionEnabled
    ? `

**Example — charting via \`code_execution\`:**

Code you run:
\`\`\`
const monthly = { Jan: 12000, Feb: 15000, Mar: 13500 };
const spec = {
  type: "bar", title: "Monthly Revenue",
  data: Object.entries(monthly).map(([x, revenue]) => ({ x, revenue })),
  series: [{ key: "revenue", label: "Revenue ($)" }], xKey: "x",
};
console.log("__CHART__" + JSON.stringify(spec));
\`\`\`

The tool's stdout then contains, e.g.:
\`\`\`
[Chart created — title: "Monthly Revenue". To display it, copy this tag verbatim into your response where the chart should appear: <Chart id="a1b2c3d4"/>]
\`\`\`

Copy the \`<Chart .../>\` tag exactly as given — the \`id\` is an opaque identifier, never the title. When you emit multiple charts, use the quoted title in each \`[Chart created ...]\` line to decide which tag goes where.

Your response prose afterward (place the tag, no data table):
\`\`\`
Revenue grew steadily through Q1, peaking in February before a slight March dip.

<Chart id="a1b2c3d4"/>
\`\`\`
`
    : '';

  return `## Charts & Graphs

${intro}

**When to use:**
- Comparing categories or values across groups → bar chart
- Trends or changes over time → line chart
- Part-to-whole proportions → pie or donut chart
- Cumulative composition over time → stacked area chart

**When NOT to use:** Tables with ≤ 4 rows, single data points, or non-numeric comparisons.

**Examples by type:**

Bar — monthly revenue:
\`\`\`
create_chart({
  type: "bar", title: "Monthly Revenue",
  data: [{x:"Jan",revenue:12000},{x:"Feb",revenue:15000},{x:"Mar",revenue:13500}],
  series: [{key:"revenue",label:"Revenue ($)"}], xKey: "x"
})
\`\`\`

Line — multi-series trend:
\`\`\`
create_chart({
  type: "line", title: "API Latency by Region",
  data: [{month:"Jan",us:120,eu:145},{month:"Feb",us:115,eu:138}],
  series: [{key:"us",label:"US"},{key:"eu",label:"EU"}], xKey: "month"
})
\`\`\`

Pie — proportions:
\`\`\`
create_chart({
  type: "pie", title: "Error Distribution",
  data: [{name:"Timeout",value:45},{name:"Auth",value:30},{name:"Other",value:25}],
  series: [{key:"value"}]
})
\`\`\`

Area — stacked composition:
\`\`\`
create_chart({
  type: "area", title: "Traffic Sources",
  data: [{month:"Jan",organic:400,paid:200},{month:"Feb",organic:450,paid:220}],
  series: [{key:"organic",stackId:"s"},{key:"paid",stackId:"s"}], xKey: "month"
})
\`\`\`
${codeExecutionExample}
**Style rules:**
- Always set a \`title\`. It labels the rendered chart and is echoed back in \`code_execution\` output so you can tell multiple charts apart.
- Prefer multi-series line over multiple separate charts when comparing related metrics.
- Use stacked area only when the total (sum of series) is meaningful.
- The value axis starts at 0 by default. For line charts where values cluster in a narrow band, set \`options.yMin\` (and optionally \`options.yMax\`) to zoom in. Avoid a non-zero \`yMin\` on bar/area charts — it distorts the visual comparison.
- Keep data rows ≤ 50; summarize or bin larger datasets before charting.${codeExecutionStyleRule}

${dontDuplicate}`;
}
