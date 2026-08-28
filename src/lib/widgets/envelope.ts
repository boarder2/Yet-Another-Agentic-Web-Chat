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
  'tool_call' | 'subagent' | 'panel' | 'artifact' | 'chart' | 'map';

const WIDGET_KINDS: ReadonlySet<string> = new Set([
  'tool_call',
  'subagent',
  'panel',
  'artifact',
  'chart',
  'map',
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

/** Writer-owned map placement. `mapId` is a private canonical context key. */
export interface MapLinkPayload {
  label: string;
  url: string;
}

export interface MapPayload {
  /** Unique placement ID, used for idempotent append/update operations. */
  id: string;
  /** Private canonical map ID; never a model-facing handle. */
  mapId: string;
  title?: string;
  /** Safe semantic summary used before/without a map renderer. */
  fallback: string;
  links?: MapLinkPayload[];
  /** Complete attribution set; old widgets contain only `attribution`. */
  attributions?: string[];
  /** First/legacy attribution retained for persisted widget compatibility. */
  attribution: string;
}

export type WidgetPayload =
  | ToolCallPayload
  | SubagentPayload
  | PanelPayload
  | ArtifactPayload
  | ChartPayload
  | MapPayload;

export type ParsedWidget =
  | { kind: 'tool_call'; payload: ToolCallPayload }
  | { kind: 'subagent'; payload: SubagentPayload }
  | { kind: 'panel'; payload: PanelPayload }
  | { kind: 'artifact'; payload: ArtifactPayload }
  | { kind: 'chart'; payload: ChartPayload }
  | { kind: 'map'; payload: MapPayload };

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
  if (kind === 'map' && !isMapPayload(payload)) return null;
  return { kind, payload } as ParsedWidget;
}

function isSafeMapText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f<>]/.test(value)
  );
}

function isSafeMapFallback(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value) &&
    !value.includes('```')
  );
}

function isSafeMapUrl(value: unknown): value is string {
  if (!isSafeMapText(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isSafeMapAttributions(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 13 &&
    value.every((attribution) => isSafeMapText(attribution, 500)) &&
    new Set(value).size === value.length
  );
}

function isMapPayload(value: unknown): value is MapPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Partial<MapPayload>;
  if (
    !isSafeMapText(payload.id, 160) ||
    !isSafeMapText(payload.mapId, 160) ||
    !isSafeMapFallback(payload.fallback) ||
    !isSafeMapText(payload.attribution, 500) ||
    (payload.attributions !== undefined &&
      !isSafeMapAttributions(payload.attributions))
  ) {
    return false;
  }
  if (payload.title !== undefined && !isSafeMapText(payload.title, 240)) {
    return false;
  }
  if (payload.links !== undefined) {
    if (!Array.isArray(payload.links) || payload.links.length > 40)
      return false;
    if (
      payload.links.some(
        (link) =>
          !link ||
          typeof link !== 'object' ||
          !isSafeMapText((link as MapLinkPayload).label, 240) ||
          !isSafeMapUrl((link as MapLinkPayload).url),
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Append a validated writer-owned map placement. */
export function appendMapWidget(content: string, payload: MapPayload): string {
  if (!isMapPayload(payload)) return content;
  return appendWidget<MapPayload>(content, 'map', payload);
}

function escapeMapLabel(value: string): string {
  return value.replace(/[\\[\]()`*_]/g, '\\$&');
}

/** Convert a map envelope into safe text/links for copy and document export. */
export function formatMapPayloadForOutput(payload: MapPayload): string {
  if (!isMapPayload(payload)) return '';
  // Keep a provider value from recreating a fenced widget when the transformed
  // text is written to Markdown or pasted into another document.
  const fallback = payload.fallback.replace(/```/g, '\\`\\`\\`').trim();
  const lines = [fallback];
  const links = (payload.links ?? []).filter(
    (link) => isSafeMapText(link.label, 240) && isSafeMapUrl(link.url),
  );
  if (links.length > 0) {
    lines.push(
      '',
      'Map links:',
      ...links.map((link) => `- [${escapeMapLabel(link.label)}](${link.url})`),
    );
  }
  const attributions = payload.attributions ?? [payload.attribution];
  if (attributions.length === 1) {
    lines.push('', `Map attribution: ${attributions[0].trim()}`);
  } else {
    lines.push(
      '',
      'Map attributions:',
      ...attributions.map((value) => `- ${value.trim()}`),
    );
  }
  return lines.join('\n');
}

/** Replace map widgets while leaving other widget stripping semantics alone. */
export function replaceMapWidgetsForOutput(content: string): string {
  return content.replace(
    /```yaawc:map\n([^\n]*)\n```/g,
    (_full, body: string) => {
      try {
        const payload = JSON.parse(body) as unknown;
        return isMapPayload(payload) ? formatMapPayloadForOutput(payload) : '';
      } catch {
        return '';
      }
    },
  );
}

export const transformMapWidgetsForOutput = replaceMapWidgetsForOutput;
export const mapWidgetsToText = replaceMapWidgetsForOutput;

/**
 * Decode a markdown-to-jsx code block into its widget payload. `className`
 * carries the fence info string as `language-xxx`/`lang-xxx` (possibly
 * duplicated — see CodeBlock). Returns `null` for anything that isn't a valid
 * `yaawc:*` envelope so callers fall back to plain code-block rendering.
 */
export function parseWidgetCodeBlock(
  className: string | undefined,
  body: unknown,
): ParsedWidget | null {
  if (!className || typeof body !== 'string') return null;
  for (const token of className.split(/\s+/)) {
    const match = /^(?:language-|lang-)(yaawc:.+)$/.exec(token);
    if (match) return parseWidgetFence(match[1], body);
  }
  return null;
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

/**
 * Rewrite one panel column's model-streamed text with `transform`. The caller
 * owns the transform so this module stays free of chart-markup knowledge.
 */
export function mapPanelColumnText(
  content: string,
  idx: number,
  transform: (text: string) => string,
): string {
  return updateWidget<PanelPayload>(
    content,
    'panel',
    PANEL_WIDGET_ID,
    (current) => ({
      ...current,
      columns: current.columns.map((c) =>
        c.idx === idx
          ? { ...c, responseText: transform(c.responseText ?? '') }
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
 * envelopes are writer-appended, never model tokens. Callers that accumulate
 * chunks run this over the accumulated text outside existing writer envelopes,
 * which also closes the split-opening-fence gap.
 */
export function neutralizeSpoofedFences(text: string): string {
  return text.replace(/```[ \t]*yaawc(?::[a-zA-Z0-9_]*)?/g, '```');
}

// Hold every suffix that could become the reserved `yaawc:` fence prefix. In
// particular, `yaawc` has one `w`; keeping this partial prefix out of the
// accumulated response closes the split-token spoofing gap.
const POSSIBLE_SPOOF_PREFIX =
  /(`{1,3}[ \t]*(?:y(?:a(?:a(?:w(?:c)?)?)?)?(?::[a-zA-Z0-9_]*)?)?)$/;

function trailingSpoofPrefix(text: string): string {
  return text.match(POSSIBLE_SPOOF_PREFIX)?.[1] ?? '';
}

/**
 * Consume one model-text chunk while holding a possible partial reserved-fence
 * prefix. Keeping the prefix out of accumulated content makes neutralization
 * correct even when a provider splits ` ```yaawc:map ` across token events.
 */
export function consumeSpoofedFenceChunk(
  pending: string,
  chunk: string,
): { text: string; pending: string } {
  const combined = pending + chunk;
  const suffix = trailingSpoofPrefix(combined);
  const stable = suffix ? combined.slice(0, -suffix.length) : combined;
  return {
    text: neutralizeSpoofedFences(stable),
    pending: suffix,
  };
}

/**
 * Flush a held partial prefix at a stream boundary; it is not a complete
 * widget. A separator is used when more model text may follow after a
 * non-response event, preventing that later text from completing the prefix.
 */
export function flushSpoofedFenceChunk(
  pending: string,
  moreTextMayFollow = false,
): string {
  const text = neutralizeSpoofedFences(pending);
  return moreTextMayFollow && text ? `${text}\u200b` : text;
}
