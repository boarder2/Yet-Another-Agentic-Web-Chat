# Artifacts and dashboards

YAAWC has two ways to keep useful output beside a conversation: agent-authored Artifacts and configurable dashboard or home widgets. Generated images also appear in the shared History view.

## Create and use artifacts

Ask an eligible chat to create a self-contained HTML document such as a report, dashboard, mini application, or visualization. The agent can create a document, read its current content, and apply an exact edit to a selected string. Each successful write creates a complete immutable version anchored to the assistant message that made the write.

Artifacts are reachable from the chat side panel, the workspace Artifacts area, and `/workspaces/<workspace-id>/artifacts/<artifact-id>` when they belong to a workspace. Use the composer `@` mention picker or the workspace artifact list to mention an existing document in another workspace chat.

Ownership is determined by the chat:

- In an unscoped chat, the artifact belongs to that chat and is removed with it.
- In a workspace chat, the workspace owns the artifact. Other chats in that workspace can read and edit it, and deleting the originating chat does not delete it.
- Private chats do not expose artifact tools, so they do not create durable artifacts.

The viewer can switch between rendered preview and source, browse versions, download HTML, and open a version in a new tab. Artifact HTML is served with a restrictive policy: no network connections or forms, an opaque sandbox origin, and only data/blob media. Inline code still comes from the agent, so review generated content before treating it as trusted.

## Generated images

When Image Generation is enabled, the agent can create a PNG, JPEG, GIF, or WebP image from a prompt through the configured OpenRouter image model. The image is attached to the assistant turn and stored as a durable generated-image record for the chat or workspace. Images are listed in History and are removed with the owning chat or workspace according to their scope. See [Models and providers](./models-and-providers.md).

## Add a dashboard widget

Open `/dashboard` or use the widget controls on the home page. Widgets can be shown on the Dashboard, the home page, both, or neither; each surface has its own responsive layout. In edit mode you can add, move, resize, refresh, edit, hide, convert, export, import, or delete widgets. View mode shows their content without management controls.

### AI widgets

An AI widget fetches one or more **Web Page** or **HTTP Data** sources, substitutes source content and date variables into a prompt, and processes the result with a selected Chat model and provider. You can choose the available helper tools for the widget and set a refresh interval in minutes or hours. A preview runs before the widget is saved.

A widget accepts at most 8 sources. Each source is bounded to 300,000 characters. Source URLs are fetched by the server, and HTTP data is fetched as raw response text; use only URLs you trust. The widget cache is used until its refresh interval expires, while **Refresh All Widgets** bypasses the cache.

### Code widgets

A code widget runs an authored JavaScript `render` function in the Docker sandbox on each refresh. Use this construction contract to build a widget: source fetching happens on the server before the sandbox; the function receives the fetched records, current time, optional location, and the user's resolved theme. It returns Markdown and can register charts with the global `chart(spec)` helper; registered chart specifications are validated after `render` returns.

#### The `render` contract

Define this function in the editor:

```js
async function render({ sources, now, location, theme }) {
  return '# A non-empty Markdown result';
}
```

The runtime invokes `render` with one object. It accepts either a synchronous result or a Promise, but the public contract is a **non-empty Markdown string**. A non-string result is coerced to text with a warning; `null`, `undefined`, or output that becomes empty after sanitization fails closed. The function must not call a model or a YAAWC API.

#### Values passed to `render`

- **`sources`** is an array of fetched source records:

  ```ts
  {
    url: string;
    type: 'Web Page' | 'HTTP Data';
    content: string;
    error?: string;
    ok: boolean;
    truncated: boolean;
  }
  ```

  `url` is the requested URL. `Web Page` content is extracted page text; `HTTP Data` content is the raw response body, so parse JSON explicitly when appropriate. A successful record has `ok: true` and its content; a failed fetch has `ok: false`, an empty `content`, and an `error` when available. Fetch failures are per-source: they do not prevent `render` from running. `truncated` is true when that source or the total retained-source budget cut its content. The array contains at most the first 8 configured sources.

- **`now`** is `{ iso: string, utcIso: string, localIso: string }`. `iso` and `utcIso` are the current instant in `Date.toISOString()` form. `localIso` is the current local wall-clock value represented in the same ISO format using the server runtime's timezone.
- **`location`** is `string | null`. When browser permission is granted, the dashboard supplies the current coordinates as a string in the form `latitude, longitude` with six decimal places. It is `null` when permission is denied, unavailable, or not requested; location is requested only when the saved code references this value.
- **`theme`** is always populated with the current resolved dashboard theme (or the runtime fallback):

  ```ts
  {
    mode: 'light' | 'dark';
    colors: {
      background: string;
      foreground: string;
      surface: string;
      surface2: string;
      border: string;
      accent: string;
      accentForeground: string;
      danger: string;
      success: string;
      warning: string;
      info: string;
    }
  }
  ```

  Color values are concrete CSS color strings. Use `theme.colors.*` for inline styles and chart series colors so the widget follows the user's current theme instead of hardcoding unrelated colors.

#### Markdown output, sanitization, and failures

The returned Markdown is sanitized before it is rendered. Scriptable or framing elements (`script`, `iframe`, `object`, `embed`, `svg`, `foreignObject`, `base`, `link`, and `style`) are removed. Inline `style` attributes are allowed and pass through without CSS sanitization, including `url(...)` values; treat them as trusted and do not interpolate untrusted URLs or CSS. Normal links and remote or raster images remain subject to the sanitizer's URI allowlist. Chart placeholders are protected while sanitization runs and restored afterward.

A failed source is available to the function as an error record, so defensive widgets can show partial results. The runtime fails closed when Docker is disabled or unreachable, the image cannot be prepared, `render` throws, no result envelope is produced, the output envelope is malformed or too large, the sanitized result is empty, or a registered chart is invalid. Timeouts and memory exhaustion also return an error without rendering unvalidated output. A chart that was registered but not embedded is a warning: the widget can succeed, but that chart is not visible.

The sandbox has no network access, host filesystem or provider credentials, and no application imports. Source URLs are still fetched by the server before execution; use only sources you trust.

#### The global `chart(spec)` helper

`chart` is available globally inside `render`; do not import it. Each call registers one chart, assigns an id in call order (`c0`, `c1`, …), and returns the exact Markdown placeholder `<Chart id="cN"/>`. After `render` returns, the runtime validates every registered specification; `chart()` itself does not throw for an invalid spec, so an invalid chart fails the widget afterward rather than being catchable around the call. Embed the returned string in the Markdown returned by `render`, at the position where the chart belongs. Creating a chart without returning its placeholder produces a warning rather than a visible chart.

The complete chart specification is:

```ts
{
  type: 'bar' | 'line' | 'area' | 'pie';
  title?: string;
  data: Array<Record<string, string | number>>;
  series: Array<{
    key: string;
    label?: string;
    color?: string;
    stackId?: string;
  }>;
  xKey?: string;
  options?: {
    orientation?: 'vertical' | 'horizontal';
    donut?: boolean;
    showLegend?: boolean;
    showGrid?: boolean;
    yLabel?: string;
    xLabel?: string;
    yMin?: number;
    yMax?: number;
  };
}
```

`title` is shown above the chart. `data` contains at least one row, and `series` contains at least one entry; each series `label` defaults to its `key`, `color` is an optional valid CSS color, and a shared `stackId` stacks bar or area series. `xKey` selects the category axis for non-pie charts and defaults to `x`. `orientation` changes bar charts between vertical and horizontal layouts. `donut` changes a pie chart to a donut. `showLegend` defaults to true; for non-pie charts, a legend appears only when it is true and there are multiple series, while pie charts display a legend whenever it is true. `showGrid` defaults to true for non-pie charts and false for pie charts. `xLabel` and `yLabel` label the axes; `yMin` and `yMax` set numeric bounds for bar and line charts. The area renderer currently accepts those fields but does not apply the bounds. Options that do not apply to a chart type have no visible effect.

#### Chart validation rules

- `data` must contain 1–1,000 rows, and every cell must be a string or number.
- `series` must contain 1–20 entries. Every `series[].key` is non-empty and must exist on every data row.
- For **bar**, **line**, and **area** charts, every data row must also contain the effective `xKey` field. If `xKey` is omitted, every row must contain `x`.
- For **pie** charts, `series` must contain exactly one entry and every data row must contain a `name` field for the slice label. The one series key is the slice value; use numbers for numeric chart values.
- `title`, `xKey`, `series.key`, `series.label`, `series.stackId`, and string-valued data cells are bounded to 500 characters. `series.color` must match a valid CSS color. The chart schema also accepts string `xLabel` and `yLabel` values; those labels and `series.color` are not part of the bounded-string check.

#### Limits and sandbox configuration

The code-widget runtime enforces these limits:

| Resource                         |              Limit |
| -------------------------------- | -----------------: |
| Sources per widget               |                  8 |
| Retained characters per source   |          2,000,000 |
| Retained source characters total |          4,000,000 |
| Widget output/result envelope    | 512,000 characters |
| Charts per widget                |                 10 |
| Data rows per chart              |              1,000 |
| Series per chart                 |                 20 |
| Bounded chart strings            |     500 characters |

The sandbox timeout and memory limit are configurable in `config.toml` under `TOOLS.CODE_EXECUTION.TIMEOUT_SECONDS` and `TOOLS.CODE_EXECUTION.MEMORY_MB`; their defaults are 30 seconds and 128 MB. A timeout or out-of-memory termination fails the widget. Code widgets require `TOOLS.CODE_EXECUTION.ENABLED = true` and a reachable Docker daemon; the widget runner applies its own 512,000-character output cap.

#### Defensive copy-paste example

This example handles an empty source list and failed sources, uses current theme colors, creates a valid chart from every fetched record, embeds the returned placeholder, and still produces useful Markdown when some sources fail:

```js
async function render({ sources, now, location, theme }) {
  const inputSources = Array.isArray(sources) ? sources : [];

  if (inputSources.length === 0) {
    return [
      '# Source report',
      '',
      `<span style="color: ${theme.colors.info}">No sources were configured.</span>`,
      '',
      `Last run: ${now.localIso}`,
    ].join('\n');
  }

  const failed = inputSources.filter((source) => !source.ok);
  const rows = inputSources.map((source, index) => ({
    name: `Source ${index + 1}`,
    characters: source.ok ? source.content.length : 0,
  }));
  const statusLines = inputSources
    .map((source, index) => {
      const state = source.ok
        ? `loaded${source.truncated ? ' (truncated)' : ''}`
        : `failed — ${source.error ?? 'unknown error'}`;
      return `- Source ${index + 1} (${source.type}): ${state}`;
    })
    .join('\n');

  const chartMarkdown = chart({
    type: 'bar',
    title: 'Fetched source characters',
    xKey: 'name',
    data: rows,
    series: [
      {
        key: 'characters',
        label: 'Characters',
        color: theme.colors.accent,
      },
    ],
    options: { showLegend: false, showGrid: true, yLabel: 'Characters' },
  });

  return [
    '# Source report',
    '',
    `<span style="color: ${theme.colors.foreground}">Loaded ${inputSources.length - failed.length} of ${inputSources.length} source(s).</span>`,
    '',
    '## Source status',
    statusLines,
    '',
    chartMarkdown,
    '',
    `<span style="color: ${theme.colors.info}">Last run: ${now.localIso}${location ? ` · Location: ${location}` : ''}</span>`,
  ].join('\n');
}
```

The code editor shows a safety warning before first use. The assistant tab can propose changes to the title, sources, and code. Proposals require acceptance by default; auto-apply can apply and preview them automatically, but you still review and save the widget. Manual edits make an in-flight proposal stale, and repeated failed auto-repairs stop after a bounded number of attempts.

## Persistence and privacy

Widget definitions, layouts, settings, and cache entries are saved in YAAWC's settings store and synchronized with the deployment's other settings. The cache can contain fetched source-derived output. LLM widgets send prompts and source content to the selected model provider. Code widgets send fetched source content into the local Docker sandbox, not to the sandbox network.

Source fetching is server-side and can reach operator-authorized internal or external URLs. Do not import a widget configuration or accept generated code without reviewing its sources and behavior. Dashboard output is sanitized before rendering; code widget output fails closed when its result envelope, charts, or size limits are invalid.

## If an artifact or widget fails

- **Artifact edit rejected:** read the latest version and use an exact string that occurs once. Concurrent edits are intentionally not silently merged.
- **Artifact unavailable:** the chat may be private, outside the owning workspace, or no longer associated with a reachable chat/workspace.
- **Widget source error:** inspect the source list and the per-widget error; a failed source can leave an AI widget without enough input, while a code widget receives an error record for that source.
- **AI widget model error:** refresh provider models, choose an available model, and check the provider credential.
- **Code widget disabled:** enable code execution and make Docker reachable. A disabled code widget can display its last saved result but cannot refresh.
- **Runtime failure:** check the preview's error and logs. Timeouts, memory exhaustion, malformed output, too many charts, and oversized output are reported without rendering unvalidated output.

For Docker configuration, see the [configuration guide](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/docs/installation/configuration.md). For storage and deletion scope, see [Privacy and data](./privacy-and-data.md).
