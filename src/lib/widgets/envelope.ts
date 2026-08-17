/**
 * Widget envelopes: the codec for in-message widget markup.
 *
 * A widget is a markdown code fence with a reserved `yaawc:<kind>` info string
 * and a compact (single-line) JSON payload:
 *
 * ```yaawc:tool_call
 * {"id":"call_abc","type":"web_search","status":"running"}
 * ```
 *
 * Because the payload is always `JSON.stringify`'d compactly, it is always
 * exactly one line and can never itself contain a raw newline or start with a
 * backtick — so a fence can never be prematurely closed by its own payload.
 *
 * Isomorphic and dependency-free: imported by the client reducer, the server
 * run host, and the renderer. Pure functions only — no DOM, no network.
 */

export type WidgetKind =
  'tool_call' | 'subagent' | 'panel' | 'artifact' | 'chart';

const WIDGET_KINDS: ReadonlySet<string> = new Set([
  'tool_call',
  'subagent',
  'panel',
  'artifact',
  'chart',
]);

/** Former `<ToolCall>` attributes as plain JSON fields (base64 dropped). */
export interface ToolCallPayload {
  id: string;
  type: string;
  status: 'running' | 'success' | 'error';
  error?: string;
  query?: string;
  url?: string;
  count?: number;
  videoId?: string;
  prompt?: string;
  imageId?: string;
  mcpArgs?: string;
  mcpResult?: string;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
  oomKilled?: boolean;
  denied?: boolean;
  description?: string;
  selectedOptions?: string;
  freeformText?: string;
  skipped?: boolean;
  context?: string;
  chartIds?: string;
  [key: string]: unknown;
}

export interface SubagentPayload {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'success' | 'error';
  toolCalls: ToolCallPayload[];
  responseText?: string;
  summary?: string;
  error?: string;
  tokenUsage?: unknown;
}

export interface PanelColumnPayload {
  idx: number;
  model: string;
  status: 'running' | 'success' | 'error';
  responseText?: string;
  sourceCount?: number;
  tokens?: number;
  error?: string;
}

export interface PanelPayload {
  id: string;
  columns: PanelColumnPayload[];
}

/** All panel executors for a message live in one envelope; there's only ever one. */
export const PANEL_WIDGET_ID = 'panel';

/** Re-entry point for an agent-authored artifact. `id` is the artifact id. */
export interface ArtifactPayload {
  id: string;
  title: string;
  version: number;
  action: 'create' | 'edit';
}

/** Writer-owned placement of a registered turn chart. `id` is never a chart handle. */
export interface ChartPayload {
  id: string;
  chartId: string;
}

export type WidgetPayload =
  | ToolCallPayload
  | SubagentPayload
  | PanelPayload
  | ArtifactPayload
  | ChartPayload;

export type ParsedWidget =
  | { kind: 'tool_call'; payload: ToolCallPayload }
  | { kind: 'subagent'; payload: SubagentPayload }
  | { kind: 'panel'; payload: PanelPayload }
  | { kind: 'artifact'; payload: ArtifactPayload }
  | { kind: 'chart'; payload: ChartPayload };

type WithId = { id: string };

/** A complete envelope: reserved info string + its one-line JSON payload. */
const WIDGET_FENCE = '```yaawc:[a-zA-Z0-9_]+\\n[^\\n]*\\n```';

function fenceRegex(kind: WidgetKind): RegExp {
  return new RegExp('```yaawc:' + kind + '\\n([^\\n]*)\\n```', 'g');
}

function makeFence(kind: WidgetKind, payload: object): string {
  return '```yaawc:' + kind + '\n' + JSON.stringify(payload) + '\n```';
}

function ensureTrailingBlankLine(s: string): string {
  if (s.endsWith('\n\n')) return s;
  return s.endsWith('\n') ? s + '\n' : s + '\n\n';
}

/**
 * Balance any dangling (unterminated) backtick fence in `content` by
 * appending a bare closing fence. A dangling fence would otherwise swallow
 * a subsequently-appended widget envelope into itself.
 */
export function balanceDanglingFence(content: string): string {
  const count = (content.match(/```/g) ?? []).length;
  if (count % 2 === 0) return content;
  return (content.endsWith('\n') ? content : content + '\n') + '```\n';
}

/** Find a widget of `kind` by `id`, or `undefined` if not present. */
export function findWidget<T extends WithId>(
  content: string,
  kind: WidgetKind,
  id: string,
): T | undefined {
  const re = fenceRegex(kind);
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    try {
      const payload = JSON.parse(match[1]) as T;
      if (payload && payload.id === id) return payload;
    } catch {
      // malformed fence body — skip
    }
  }
  return undefined;
}

/**
 * Append a widget envelope to `content`. Idempotent: if a widget of the same
 * kind + id already exists, `content` is returned unchanged. Balances any
 * dangling fence first so the new envelope isn't swallowed into it.
 */
export function appendWidget<T extends WithId>(
  content: string,
  kind: WidgetKind,
  payload: T,
): string {
  if (findWidget<T>(content, kind, payload.id) !== undefined) return content;
  const balanced = balanceDanglingFence(content);
  const sep = balanced.length === 0 ? '' : ensureTrailingBlankLine(balanced);
  return (sep || balanced) + makeFence(kind, payload) + '\n\n';
}

/** Append a writer-owned chart placement, keyed by its unique placement id. */
export function appendChartWidget(
  content: string,
  payload: ChartPayload,
): string {
  return appendWidget<ChartPayload>(content, 'chart', payload);
}

export const appendChartPlacementWidget = appendChartWidget;

/**
 * Locate the widget of `kind` + `id` in `content` and replace its payload
 * with `patch` (a partial merge) or the result of `updater(current)`.
 * Returns `content` unchanged if the widget isn't found.
 */
export function updateWidget<T extends WithId>(
  content: string,
  kind: WidgetKind,
  id: string,
  patch: Partial<T> | ((current: T) => T),
): string {
  const re = fenceRegex(kind);
  let found = false;
  const result = content.replace(re, (full, body: string) => {
    let payload: T;
    try {
      payload = JSON.parse(body) as T;
    } catch {
      return full;
    }
    if (!payload || payload.id !== id) return full;
    found = true;
    const updated =
      typeof patch === 'function'
        ? (patch as (current: T) => T)(payload)
        : { ...payload, ...patch };
    return makeFence(kind, updated);
  });
  return found ? result : content;
}

/**
 * Render-side decode + validation of a fenced code block. Returns `null` when
 * the info string isn't a known `yaawc:*` kind or the body doesn't parse into
 * a valid payload (has a string `id`) — callers fall back to plain code-block
 * rendering.
 */
export function parseWidgetFence(
  infoString: string,
  body: string,
): ParsedWidget | null {
  const m = /^yaawc:([a-zA-Z0-9_]+)$/.exec(infoString.trim());
  if (!m) return null;
  const kind = m[1];
  if (!WIDGET_KINDS.has(kind)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as { id?: unknown }).id !== 'string'
  ) {
    return null;
  }
  if (
    kind === 'chart' &&
    typeof (payload as { chartId?: unknown }).chartId !== 'string'
  ) {
    return null;
  }
  return { kind, payload } as ParsedWidget;
}

/**
 * Insert a nested tool-call entry into a subagent's `toolCalls` array
 * (idempotent on `id` — a replayed/seeded entry is not duplicated).
 */
export function upsertNestedToolCall(
  toolCalls: ToolCallPayload[],
  entry: ToolCallPayload,
): ToolCallPayload[] {
  if (toolCalls.some((t) => t.id === entry.id)) return toolCalls;
  return [...toolCalls, entry];
}

/** Patch a nested tool-call entry within a subagent's `toolCalls` array by id. */
export function patchNestedToolCall(
  toolCalls: ToolCallPayload[],
  id: string,
  patch: Partial<ToolCallPayload>,
): ToolCallPayload[] {
  return toolCalls.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/** Ensure the single per-message `panel` envelope exists, seeding it empty if not. */
function ensurePanelWidget(content: string): string {
  return appendWidget<PanelPayload>(content, 'panel', {
    id: PANEL_WIDGET_ID,
    columns: [],
  });
}

/** Start (or no-op if already present) a panel executor column. */
export function startPanelColumn(
  content: string,
  idx: number,
  model: string,
): string {
  return updateWidget<PanelPayload>(
    ensurePanelWidget(content),
    'panel',
    PANEL_WIDGET_ID,
    (current) => {
      if (current.columns.some((c) => c.idx === idx)) return current;
      const columns = [
        ...current.columns,
        { idx, model, status: 'running' as const, responseText: '' },
      ].sort((a, b) => a.idx - b.idx);
      return { ...current, columns };
    },
  );
}

/** Append a streamed response token to a panel executor column. */
export function appendPanelColumnToken(
  content: string,
  idx: number,
  token: string,
): string {
  if (!token) return content;
  return updateWidget<PanelPayload>(
    content,
    'panel',
    PANEL_WIDGET_ID,
    (current) => ({
      ...current,
      columns: current.columns.map((c) =>
        c.idx === idx
          ? { ...c, responseText: (c.responseText ?? '') + token }
          : c,
      ),
    }),
  );
}

function removeRawChartTags(text: string): string {
  return text
    .replace(/<Chart\b[^>]*\/>/g, '')
    .replace(/<Chart\b[^>]*>[\s\S]*?<\/Chart>/g, '');
}

/** Remove model-authored chart tags from one panel column, preserving nested widgets. */
export function stripPanelColumnModelTags(
  content: string,
  idx: number,
): string {
  return updateWidget<PanelPayload>(
    content,
    'panel',
    PANEL_WIDGET_ID,
    (current) => ({
      ...current,
      columns: current.columns.map((c) =>
        c.idx === idx
          ? {
              ...c,
              responseText: mapOutsideWidgets(
                c.responseText ?? '',
                removeRawChartTags,
              ),
            }
          : c,
      ),
    }),
  );
}

/** Append a structured chart placement inside a panel executor column. */
export function appendPanelColumnChart(
  content: string,
  idx: number,
  payload: ChartPayload,
): string {
  return updateWidget<PanelPayload>(
    ensurePanelWidget(content),
    'panel',
    PANEL_WIDGET_ID,
    (current) => {
      let columns = current.columns;
      if (!columns.some((c) => c.idx === idx)) {
        columns = [
          ...columns,
          {
            idx,
            model: `Model ${idx + 1}`,
            status: 'running' as const,
            responseText: '',
          },
        ].sort((a, b) => a.idx - b.idx);
      }
      return {
        ...current,
        columns: columns.map((c) =>
          c.idx === idx
            ? {
                ...c,
                responseText: appendChartWidget(c.responseText ?? '', payload),
              }
            : c,
        ),
      };
    },
  );
}

export const appendPanelColumnChartWidget = appendPanelColumnChart;

/** Set a panel executor column's terminal status, creating the column if it doesn't exist yet. */
export function setPanelColumnStatus(
  content: string,
  idx: number,
  status: 'success' | 'error',
  opts?: {
    sourceCount?: number;
    tokens?: number;
    error?: string;
    model?: string;
  },
): string {
  return updateWidget<PanelPayload>(
    ensurePanelWidget(content),
    'panel',
    PANEL_WIDGET_ID,
    (current) => {
      let columns = current.columns;
      if (!columns.some((c) => c.idx === idx)) {
        columns = [
          ...columns,
          {
            idx,
            model: opts?.model ?? `Model ${idx + 1}`,
            status,
            responseText: '',
          },
        ].sort((a, b) => a.idx - b.idx);
      }
      columns = columns.map((c) =>
        c.idx === idx
          ? {
              ...c,
              status,
              ...(opts?.sourceCount !== undefined && {
                sourceCount: opts.sourceCount,
              }),
              ...(opts?.tokens !== undefined && { tokens: opts.tokens }),
              ...(opts?.error && { error: opts.error }),
            }
          : c,
      );
      return { ...current, columns };
    },
  );
}

/**
 * Add or refresh an artifact's card. A message gets one card per artifact no
 * matter how many times the agent edits it during the turn, so repeated saves
 * bump the existing card's version rather than stacking new ones. Shared by
 * both writers (the live client reducer and the persisted server copy) so the
 * two stay byte-identical.
 */
export function upsertArtifactWidget(
  content: string,
  payload: ArtifactPayload,
): string {
  return findWidget<ArtifactPayload>(content, 'artifact', payload.id)
    ? updateWidget<ArtifactPayload>(content, 'artifact', payload.id, payload)
    : appendWidget<ArtifactPayload>(content, 'artifact', payload);
}

/** Remove all `yaawc:*` widget fences from `content` (LLM context, clipboard). */
export function stripWidgets(content: string): string {
  return content.replace(new RegExp(WIDGET_FENCE + '\\n?', 'g'), '');
}

const MASK = (i: number) => `@@yaawc-widget-${i}@@`;
const MASK_RE = /@@yaawc-widget-(\d+)@@/g;

/**
 * Replace every envelope with an inert single-line placeholder, returning the
 * removed fences for {@link unmaskWidgets}.
 *
 * A payload is verbatim model text inside one line of JSON, so it can contain
 * anything markdown preprocessing looks for — `<Chart .../>`, `<think>`, a
 * legacy `<ToolCall>` tag. Rewriting inside a payload (say, padding a match
 * with blank lines) destroys the one-line invariant the fence depends on and
 * the whole widget stops parsing. Preprocessors mask first and restore last, so
 * envelopes stay opaque.
 */
export function maskWidgets(content: string): {
  text: string;
  fences: string[];
} {
  const fences: string[] = [];
  const text = content.replace(new RegExp(WIDGET_FENCE, 'g'), (fence) => {
    fences.push(fence);
    return MASK(fences.length - 1);
  });
  return { text, fences };
}

/** Restore the fences removed by {@link maskWidgets}. */
export function unmaskWidgets(text: string, fences: string[]): string {
  if (fences.length === 0) return text;
  return text.replace(MASK_RE, (m, i: string) => fences[Number(i)] ?? m);
}

/** Rewrite `content` with `fn`, leaving widget envelopes untouched. */
export function mapOutsideWidgets(
  content: string,
  fn: (text: string) => string,
): string {
  const { text, fences } = maskWidgets(content);
  return unmaskWidgets(fn(text), fences);
}

/**
 * Downgrade any `yaawc:`-prefixed fence info string in model-streamed text to
 * a bare fence, so a model can never spoof a widget — all legitimate
 * envelopes are writer-appended, never model tokens.
 */
export function neutralizeSpoofedFences(text: string): string {
  return text.replace(/```yaawc:[a-zA-Z0-9_]*/g, '```');
}
