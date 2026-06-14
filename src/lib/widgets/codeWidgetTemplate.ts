// Default code seeded into a new code widget. Documents the render contract
// and shows a working chart() example.
import { WIDGET_THEME_CONTRACT } from './widgetTheme';

export const CODE_WIDGET_TEMPLATE = `// A code widget transforms server-fetched source data into markdown.
// Define render(); return a markdown string. Use chart(spec) to embed a chart.
//
//   sources: [{ url, type, content, error, ok, truncated }]
//     content is a RAW STRING: page text (Web Page) or response body (HTTP Data).
//     For JSON APIs: const data = JSON.parse(sources[0].content);
//   now: { iso, utcIso, localIso }
//   ${WIDGET_THEME_CONTRACT}
//
// Also available: location (string | null) — add it to the args below to use
// the user's coordinates. The dashboard asks for the location permission only
// when your code references it.
//
// No network / require / import / fs / process — just compute and return.

async function render({ sources, now, theme }) {
  if (sources.length === 0) {
    return \`# Hello\\n\\nThe time is **\${now.localIso}**.\`;
  }

  // Example: chart the lengths of each fetched source, themed to the dashboard.
  const chartMd = chart({
    type: 'bar',
    title: 'Source content size',
    xKey: 'name',
    series: [{ key: 'chars', label: 'Characters', color: theme.colors.accent }],
    data: sources.map((s, i) => ({
      name: \`Source \${i + 1}\`,
      chars: s.content.length,
    })),
  });

  return \`# \${sources.length} source(s) loaded\\n\\n\${chartMd}\`;
}
`;
