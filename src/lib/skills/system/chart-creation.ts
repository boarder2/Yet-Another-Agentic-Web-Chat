import type { Skill } from '../types';
import { getCodeExecutionConfig } from '@/lib/config';

const DESCRIPTION =
  'How to create interactive bar/line/area/pie charts — full spec schema, worked payload examples for each chart type, and how to emit charts from the right tool.';

const INTRO_COMMON = `# Creating charts

The app renders four interactive chart types: **bar**, **line**, **area**, and **pie** (with an optional donut variant). Charts are produced from a \`ChartSpec\` payload that you build, then embedded in your reply with a self-closing \`<Chart id="..."/>\` tag.`;

const PATH_WITH_CODE_EXECUTION = `## Which path to use

You have two ways to produce a chart on this server.

### Preferred: emit the chart from \`code_execution\`

**Prefer this path** for any chart whose data needs computation — aggregations, percentages, growth rates, parsing a list the user gave you, sorting, filtering, top-N, etc. Building the data inside reasoning is error-prone; building it in code is exact.

To emit a chart from \`code_execution\`, \`console.log\` a single line in this exact envelope:

\`\`\`
__CHART__<json>
\`\`\`

where \`<json>\` is a valid \`ChartSpec\` object. The runtime picks up the line, validates it, assigns a \`chartId\`, and replaces the line with a note telling you the id and the \`<Chart id="..."/>\` tag to insert in your final answer.

\`\`\`js
const data = [
  { quarter: 'Q1', revenue: 120, costs: 80 },
  { quarter: 'Q2', revenue: 150, costs: 95 },
  { quarter: 'Q3', revenue: 175, costs: 110 },
  { quarter: 'Q4', revenue: 210, costs: 130 },
];
// Derive a profit series so the LLM doesn't have to do the math.
const enriched = data.map(d => ({ ...d, profit: d.revenue - d.costs }));

console.log('__CHART__' + JSON.stringify({
  type: 'bar',
  title: '2025 Quarterly Performance',
  xKey: 'quarter',
  data: enriched,
  series: [
    { key: 'revenue', label: 'Revenue ($M)', color: '#3b82f6' },
    { key: 'costs',   label: 'Costs ($M)',   color: '#ef4444' },
    { key: 'profit',  label: 'Profit ($M)',  color: '#10b981' },
  ],
  options: { showLegend: true, showGrid: true, yLabel: 'Millions USD' },
}));
\`\`\`

You may emit **multiple** \`__CHART__\` lines in one execution to produce several charts. Lines that are not valid \`ChartSpec\`s are replaced with a "Chart skipped" note — read the stdout to see if anything was rejected.

After execution, the tool output will tell you the assigned \`chartId\` for each chart. Insert \`<Chart id="<that-id>"/>\` verbatim in your final response where the chart should appear.

### Fallback: call \`create_chart\` directly

Use \`create_chart\` when the chart data is small, hand-authored, and needs no computation — e.g. the user literally gave you five numbers.

\`create_chart\` takes the same \`ChartSpec\` as its arguments and returns \`{"chartId": "..."}\`. Insert \`<Chart id="<that-id>"/>\` in your response.

Do not use both paths for the same chart.`;

const PATH_WITHOUT_CODE_EXECUTION = `## How to create a chart

Call the \`create_chart\` tool with a \`ChartSpec\` payload. It validates the spec, returns \`{"chartId": "..."}\`, and you insert \`<Chart id="<that-id>"/>\` verbatim in your final response where the chart should appear.

If the data needs derivation (percentages, growth rates, aggregations), compute the values carefully before building the payload — there is no sandboxed code path available on this server, so any arithmetic happens in your reasoning. Double-check totals when accuracy matters.`;

const SCHEMA_AND_EXAMPLES = `## The \`ChartSpec\` schema

\`\`\`ts
{
  type: 'bar' | 'line' | 'area' | 'pie';
  title?: string;                          // shown above the chart
  data: Array<Record<string, string | number>>;  // >= 1 row
  series: Array<{
    key: string;                           // must exist on every data row
    label?: string;                        // legend label (defaults to key)
    color?: string;                        // any valid CSS color
    stackId?: string;                      // share a stackId to stack series
  }>;                                       // >= 1 entry
  xKey?: string;                           // defaults to 'x' (ignored for pie)
  options?: {
    orientation?: 'vertical' | 'horizontal'; // bar only
    donut?: boolean;                       // pie only
    showLegend?: boolean;
    showGrid?: boolean;
    xLabel?: string;
    yLabel?: string;
    yMin?: number;
    yMax?: number;
  };
}
\`\`\`

### Validation rules (these will reject the spec if violated)

- **bar/line/area:** every row in \`data\` must contain the \`xKey\` field (default \`'x'\`) **and** every \`series[].key\` field.
- **pie:** must have **exactly one** series, and every row in \`data\` must have a \`name\` field (the slice label). The series \`key\` is the numeric value.
- \`series\` cannot be empty; \`data\` cannot be empty.
- \`color\`, if provided, must be a valid CSS color: \`#rgb\`/\`#rrggbb\`/\`#rrggbbaa\`, \`rgb(...)\`, \`rgba(...)\`, \`hsl(...)\`, \`hsla(...)\`, \`oklch(...)\`, \`oklab(...)\`, \`lab(...)\`, \`lch(...)\`, \`hwb(...)\`, \`color(...)\`, \`var(--token)\`, or a CSS named color (\`steelblue\`).

## Picking a chart type

- **bar** — comparing discrete categories or showing a small number of time buckets. Use \`orientation: 'horizontal'\` for long category names.
- **line** — continuous trends over an ordered axis (time, version, index).
- **area** — same as line but emphasizes magnitude/cumulative volume; great for stacked compositions over time (use \`stackId\`).
- **pie** — composition of a whole when there are 3–7 slices. Use \`donut: true\` for a cleaner look with a central label. Avoid for >7 slices; use a bar chart instead.

## Worked examples (each is a complete, valid \`ChartSpec\`)

### 1. Single-series line chart

\`\`\`json
{
  "type": "line",
  "title": "Weekly active users",
  "xKey": "week",
  "data": [
    { "week": "W1", "wau": 1240 },
    { "week": "W2", "wau": 1380 },
    { "week": "W3", "wau": 1305 },
    { "week": "W4", "wau": 1490 }
  ],
  "series": [{ "key": "wau", "label": "WAU", "color": "#6366f1" }],
  "options": { "showGrid": true, "yLabel": "Users" }
}
\`\`\`

### 2. Stacked area chart (shared \`stackId\`)

\`\`\`json
{
  "type": "area",
  "title": "Traffic source mix",
  "xKey": "month",
  "data": [
    { "month": "Jan", "organic": 4200, "paid": 1800, "referral":  900 },
    { "month": "Feb", "organic": 4800, "paid": 2100, "referral": 1100 },
    { "month": "Mar", "organic": 5100, "paid": 2000, "referral": 1250 }
  ],
  "series": [
    { "key": "organic",  "color": "#10b981", "stackId": "t" },
    { "key": "paid",     "color": "#f59e0b", "stackId": "t" },
    { "key": "referral", "color": "#3b82f6", "stackId": "t" }
  ],
  "options": { "showLegend": true, "yLabel": "Sessions" }
}
\`\`\`

### 3. Horizontal bar chart

\`\`\`json
{
  "type": "bar",
  "title": "Top languages by repo count",
  "xKey": "language",
  "data": [
    { "language": "TypeScript", "repos": 142 },
    { "language": "Python",     "repos": 118 },
    { "language": "Go",         "repos":  64 },
    { "language": "Rust",       "repos":  47 }
  ],
  "series": [{ "key": "repos", "color": "#0ea5e9" }],
  "options": { "orientation": "horizontal", "xLabel": "Repos" }
}
\`\`\`

### 4. Donut (pie) chart — note \`name\` field is mandatory

\`\`\`json
{
  "type": "pie",
  "title": "Budget allocation",
  "data": [
    { "name": "Engineering", "value": 52 },
    { "name": "Sales",       "value": 23 },
    { "name": "Marketing",   "value": 15 },
    { "name": "G&A",         "value": 10 }
  ],
  "series": [{ "key": "value", "color": "#8b5cf6" }],
  "options": { "donut": true, "showLegend": true }
}
\`\`\`

### 5. Bar chart with custom \`xKey\`

\`\`\`json
{
  "type": "bar",
  "title": "Latency by endpoint (p95, ms)",
  "xKey": "endpoint",
  "data": [
    { "endpoint": "/login",  "p95": 240 },
    { "endpoint": "/search", "p95": 410 },
    { "endpoint": "/checkout","p95": 880 }
  ],
  "series": [{ "key": "p95", "label": "p95 latency", "color": "#ef4444" }],
  "options": { "yLabel": "ms", "yMin": 0 }
}
\`\`\`

## Placing the chart in your reply

After the tool succeeds, the chart is referenced by id. Put the tag exactly where you want the chart rendered:

\`\`\`
Here's how revenue tracked against costs this year:

<Chart id="b4f8…"/>

The Q4 jump came from the enterprise renewal cycle.
\`\`\`

- The tag is self-closing and must be on its own line for cleanest rendering.
- Use the id verbatim — do not invent ids, and do not reuse an id across charts.
- If you forget to include the tag, the chart simply won't appear.

## Tips that prevent rejections

- For non-pie charts, set \`xKey\` explicitly and make sure every row has that field. If you leave \`xKey\` off, the default is \`'x'\` — your data must then have an \`x\` key.
- For pie charts: \`name\` (slice label) goes on each \`data\` row; the numeric series key is up to you (commonly \`value\`).
- Color is optional. If you skip it, the UI will pick a sensible default — handy when you don't want to think about palette choices.
- Keep labels short; long legend strings get truncated in the UI.
- Numbers in \`data\` should be numbers, not strings — \`"42"\` will display but won't be treated as numeric for axis scaling.`;

export function buildChartCreationSkill(): Skill {
  const ce = getCodeExecutionConfig();
  const codeExecutionAvailable =
    ce.enabled && !('validationError' in ce && ce.validationError);

  const pathSection = codeExecutionAvailable
    ? PATH_WITH_CODE_EXECUTION
    : PATH_WITHOUT_CODE_EXECUTION;

  const content = [INTRO_COMMON, pathSection, SCHEMA_AND_EXAMPLES].join('\n\n');

  return {
    source: 'system',
    name: 'chart-creation',
    description: DESCRIPTION,
    content,
  };
}
