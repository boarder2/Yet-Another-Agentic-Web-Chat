import type { Skill } from '../types';
import { getCodeExecutionConfig } from '@/lib/config';
import {
  TURN_CHART_MAX_PLACEMENTS,
  TURN_CHART_MAX_REGISTRATIONS,
} from '@/lib/chart/turnChartRegistry';

const DESCRIPTION =
  'Optional reference for the turn-local create_chart/show_chart lifecycle and the simplified chart input.';

const COMMON = [
  '# Creating charts',
  '',
  'Charts are turn-local writer widgets. Register a chart with create_chart, then call show_chart with the short handle returned by the registration. Never author HTML, a <Chart> tag, or an internal chart ID. A registered chart remains invisible until it is shown, and it may be shown more than once.',
  '',
  '## Simplified input',
  '',
  'For bar, line, or area:',
  '',
  '{',
  '  "type": "bar",',
  '  "title": "Monthly revenue",',
  '  "labels": ["Jan", "Feb", "Mar"],',
  '  "series": [',
  '    { "label": "Revenue", "values": [120, 150, 135], "color": "#4f46e5" }',
  '  ],',
  '  "options": {',
  '    "orientation": "vertical",',
  '    "stacked": false,',
  '    "showLegend": true,',
  '    "showGrid": true,',
  '    "xLabel": "Month",',
  '    "yLabel": "USD",',
  '    "yMin": 0,',
  '    "yMax": 200',
  '  }',
  '}',
  '',
  'For pie:',
  '',
  '{',
  '  "type": "pie",',
  '  "title": "Budget share",',
  '  "slices": [',
  '    { "label": "Engineering", "value": 60, "color": "#4f46e5" },',
  '    { "label": "Operations", "value": 40, "color": "#14b8a6" }',
  '  ],',
  '  "options": { "donut": true, "showLegend": true }',
  '}',
  '',
  'Titles and labels are required and trimmed. Cartesian series values must align with labels. Displayed labels must be unique, including numeric/string collisions. Values must be finite; pie values must be non-negative with a positive total. Only applicable options are accepted. When both bounds are present, yMin must be less than yMax. Limits are 100 labels, 15 Cartesian series, and 20 pie slices. Colors are optional valid CSS colors.',
  '',
  '## Placement',
  '',
  'Call the tools in this order:',
  'create_chart({ type: "line", title: "Trend", labels: ["A", "B"], series: [{ label: "Value", values: [1, 2] }] })',
  '→ { "handle": "chart_1", "title": "Trend" }',
  'show_chart({ handle: "chart_1" })',
  '',
  'Use the exact handle from the current turn. If show_chart rejects a handle, use its available-handle feedback or create a new chart. The skill is optional and does not need to be loaded before the first chart.',
  '',
  'Only the tool call places a chart. A handle or tool name typed into the answer text ({chart_1}, a bare show_chart line) is stripped before the reader sees it.',
  '',
  `A turn can register at most ${TURN_CHART_MAX_REGISTRATIONS} charts and call show_chart at most ${TURN_CHART_MAX_PLACEMENTS} times; a call past either cap fails and lists the handles you already have.`,
].join('\n');

const CODE_EXECUTION = [
  '## Computed chart data',
  '',
  'When values need aggregation, sorting, parsing, or other exact computation, use code_execution. It injects a global chart(spec) helper. Call it once per chart; it returns nothing, and the tool result lists the short handles and titles. Registration is silent, so call show_chart for every handle that belongs in the answer.',
  '',
  'const rows = [',
  "  { label: 'Q1', value: 120 },",
  "  { label: 'Q2', value: 150 },",
  '];',
  'chart({',
  "  type: 'bar',",
  "  title: 'Quarterly revenue',",
  '  labels: rows.map((row) => row.label),',
  "  series: [{ label: 'Revenue', values: rows.map((row) => row.value) }],",
  '});',
  '',
  'Invalid emissions are reported independently. Nonzero, timed-out, or out-of-memory executions register no charts.',
].join('\n');

export function buildChartCreationSkill(): Skill {
  const config = getCodeExecutionConfig();
  const codeExecutionAvailable =
    config.enabled && !('validationError' in config && config.validationError);

  return {
    source: 'system',
    name: 'chart-creation',
    description: DESCRIPTION,
    content: codeExecutionAvailable ? `${COMMON}\n${CODE_EXECUTION}` : COMMON,
    disableModelInvocation: false,
  };
}
