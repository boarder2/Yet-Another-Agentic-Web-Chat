/**
 * Charting guidance injected into agent prompts for focus modes that include create_chart.
 */
export const chartingGuidance = `## Charts & Graphs

Use \`create_chart\` to render interactive charts inline when presenting numeric comparisons, trends, or proportions. After calling the tool, place \`<Chart id="<chartId>"/>\` exactly where the chart should appear in your prose.

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

**Style rules:**
- Prefer multi-series line over multiple separate charts when comparing related metrics.
- Use stacked area only when the total (sum of series) is meaningful.
- Keep data rows ≤ 50; summarize or bin larger datasets before charting.
- If computing chart data from a file or large dataset, use \`code_execution\` and emit the spec via \`console.log("__CHART__" + JSON.stringify(spec))\`.`;
