import crypto from 'crypto';
import { getCodeExecutionConfig } from '@/lib/config';
import {
  executeCode,
  ensureImage,
  checkDockerAvailable,
} from '@/lib/sandbox/dockerExecutor';
import {
  ChartSpecSchema,
  ChartSpec,
  CHART_MAX_PER_WIDGET,
} from '@/lib/chart/chartSpec';
import {
  fetchSourceContent,
  FetchedSource,
  MAX_SOURCES_PER_WIDGET,
} from './sources';
import { sanitizeWidgetMarkdown } from './sanitizeWidgetOutput';
import { Source, WidgetTheme } from '@/lib/types/widget';
import { DEFAULT_WIDGET_THEME } from '@/lib/widgets/widgetTheme';
import { CodeWidgetRunLogs } from '@/lib/types/api';

// Per-source fetch cap for code widgets — larger than the LLM widget's 50 KB
// (which is sized to bound prompt tokens) since code can process big datasets
// or base64 payloads. Bounded by the total stdin budget below.
const CODE_WIDGET_SOURCE_CAP = 2_000_000;
// Total stdin payload across all sources. Held in the sandbox's heap
// (MEMORY_MB, default 128) as a string + parsed object, so keep it a few MB.
// Raise MEMORY_MB alongside this if widgets need bigger inputs.
const MAX_STDIN_BYTES = 4_000_000;
// The whole widget result (markdown + charts JSON) is one stdout envelope, so
// the sandbox stdout cap must comfortably exceed it or the envelope truncates
// and fails to parse. Generous but bounded (DB-synced) — oversized fails closed.
const MAX_WIDGET_OUTPUT_CHARS = 512_000;

// Harness prefix lines are PINNED — error line mapping from [eval]:L:C subtracts
// this count to recover the user's editor line. Keep these as discrete lines.
const HARNESS_PREFIX = [
  `const __input = JSON.parse(require('fs').readFileSync(0, 'utf8'));`,
  `console.log = console.info = console.debug = console.warn = console.error;`,
  `const __charts = [];`,
  `function chart(spec){const id='c'+__charts.length;__charts.push({id,spec});return '<Chart id="'+id+'"/>';}`,
];
const HARNESS_PREFIX_LINES = HARNESS_PREFIX.length;

function buildHarness(userCode: string, nonce: string): string {
  return [
    ...HARNESS_PREFIX,
    userCode,
    `Promise.resolve().then(()=>render(__input))`,
    `.then((out)=>process.stdout.write(${JSON.stringify(
      '__WIDGET__' + nonce,
    )}+JSON.stringify({output:typeof out==='string'?out:String(out??''),outputWasString:typeof out==='string',charts:__charts})))`,
    `.catch((e)=>{process.stderr.write(String((e&&e.stack)||e));process.exit(1);});`,
  ].join('\n');
}

// ── Server-side concurrency semaphore (mandatory, §3.4) ─────────────────────
const MAX_CONCURRENT = 3;
type SemaphoreState = { active: number; queue: Array<() => void> };
const g = globalThis as typeof globalThis & {
  __codeWidgetSemaphore?: SemaphoreState;
};
const sem =
  g.__codeWidgetSemaphore ??
  (g.__codeWidgetSemaphore = { active: 0, queue: [] });

async function acquire(): Promise<void> {
  if (sem.active < MAX_CONCURRENT) {
    sem.active++;
    return;
  }
  await new Promise<void>((resolve) => sem.queue.push(resolve));
}
function release(): void {
  const next = sem.queue.shift();
  if (next) next();
  else sem.active--;
}

export interface CodeWidgetResult {
  success: boolean;
  content: string;
  charts: Record<string, ChartSpec>;
  logs: CodeWidgetRunLogs;
  error?: string;
  warnings?: string[];
  sourcesFetched: number;
  totalSources: number;
}

const emptyLogs: CodeWidgetRunLogs = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  oomKilled: false,
};

function fail(
  error: string,
  logs: CodeWidgetRunLogs = emptyLogs,
  extra: Partial<CodeWidgetResult> = {},
): CodeWidgetResult {
  return {
    success: false,
    content: '',
    charts: {},
    logs,
    error,
    sourcesFetched: 0,
    totalSources: 0,
    ...extra,
  };
}

// Best-effort: rewrite [eval]:L:C references to the user's editor line.
function remapStderr(stderr: string): string {
  return stderr.replace(
    /(?:\[eval\]|evalmachine\.<anonymous>):(\d+)(?::(\d+))?/g,
    (_m, line: string, col?: string) => {
      const userLine = Number(line) - HARNESS_PREFIX_LINES;
      const where = userLine >= 1 ? `near line ${userLine}` : 'in harness';
      return col ? `${where} (col ${col})` : where;
    },
  );
}

export async function runCodeWidget(input: {
  code: string;
  sources: Source[];
  location?: string;
  theme?: WidgetTheme;
}): Promise<CodeWidgetResult> {
  const cfg = getCodeExecutionConfig();
  if (!cfg.enabled || 'validationError' in cfg) {
    return fail('Code execution is disabled.');
  }
  if (!(await checkDockerAvailable())) {
    return fail('Sandbox unavailable — Docker is not reachable.');
  }

  const sources = (input.sources ?? []).slice(0, MAX_SOURCES_PER_WIDGET);

  await acquire();
  try {
    // Fetch sources (see sources.ts re: deliberate no-SSRF-guard). Cap total
    // stdin payload.
    const fetched: FetchedSource[] = await Promise.all(
      sources.map((s) => fetchSourceContent(s, CODE_WIDGET_SOURCE_CAP)),
    );
    let budget = MAX_STDIN_BYTES;
    for (const f of fetched) {
      if (f.content.length > budget) {
        f.content = f.content.slice(0, Math.max(0, budget));
        f.truncated = true;
      }
      budget -= f.content.length;
    }

    const now = new Date();
    const stdinObj = {
      sources: fetched.map((f) => ({
        url: f.url,
        type: f.type,
        content: f.content,
        error: f.error,
        ok: f.ok,
        truncated: f.truncated,
      })),
      now: {
        iso: now.toISOString(),
        utcIso: now.toISOString(),
        localIso: new Date(
          now.getTime() - now.getTimezoneOffset() * 60000,
        ).toISOString(),
      },
      location: input.location ?? null,
      // Always populate theme (default when the caller omits it) so widget code
      // can read theme.colors.* without null guards.
      theme: input.theme ?? DEFAULT_WIDGET_THEME,
    };

    const nonce = crypto.randomBytes(16).toString('hex');
    const harness = buildHarness(input.code, nonce);

    try {
      await ensureImage(cfg.dockerImage);
    } catch {
      return fail('Sandbox unavailable — failed to prepare the runtime image.');
    }

    const exec = await executeCode(harness, {
      stdin: JSON.stringify(stdinObj),
      maxOutputChars: MAX_WIDGET_OUTPUT_CHARS,
    });
    const logs: CodeWidgetRunLogs = {
      stdout: exec.stdout,
      stderr: remapStderr(exec.stderr),
      exitCode: exec.exitCode,
      timedOut: exec.timedOut,
      oomKilled: exec.oomKilled,
    };
    const sourcesFetched = fetched.filter((f) => f.ok).length;
    const totalSources = fetched.length;
    const withCounts = (r: CodeWidgetResult): CodeWidgetResult => ({
      ...r,
      sourcesFetched,
      totalSources,
    });

    if (exec.timedOut) {
      return withCounts(fail('Execution timed out.', logs));
    }
    if (exec.oomKilled) {
      return withCounts(
        fail('Out of memory — the widget exceeded its memory limit.', logs),
      );
    }

    // Nonce-framed, fail-closed parse. The marker must appear EXACTLY once.
    const marker = '__WIDGET__' + nonce;
    const idx = exec.stdout.indexOf(marker);
    const last = exec.stdout.lastIndexOf(marker);
    if (idx === -1) {
      const msg =
        exec.exitCode !== 0
          ? 'Runtime error — the widget code threw before producing output.'
          : 'No output — render() did not return a result.';
      return withCounts(fail(msg, logs));
    }
    if (idx !== last) {
      return withCounts(
        fail(
          'Invalid output — the result envelope was emitted more than once.',
          logs,
        ),
      );
    }

    let parsed: {
      output?: unknown;
      outputWasString?: boolean;
      charts?: unknown;
    };
    try {
      parsed = JSON.parse(exec.stdout.slice(idx + marker.length));
    } catch {
      const tooLarge = exec.stdout.length >= MAX_WIDGET_OUTPUT_CHARS;
      return withCounts(
        fail(
          tooLarge
            ? `Output too large — the result exceeded ${MAX_WIDGET_OUTPUT_CHARS.toLocaleString()} characters and was truncated.`
            : 'Malformed output — the result envelope could not be parsed.',
          logs,
        ),
      );
    }

    const warnings: string[] = [];
    if (parsed.outputWasString === false) {
      warnings.push(
        'render() returned a non-string value; it was coerced to text.',
      );
    }

    // Validate + size-cap charts. Oversized → fail closed.
    const rawCharts = Array.isArray(parsed.charts) ? parsed.charts : [];
    if (rawCharts.length > CHART_MAX_PER_WIDGET) {
      return withCounts(
        fail(
          `Too many charts — at most ${CHART_MAX_PER_WIDGET} per widget.`,
          logs,
        ),
      );
    }
    const charts: Record<string, ChartSpec> = {};
    for (const entry of rawCharts as Array<{ id?: string; spec?: unknown }>) {
      if (!entry || typeof entry.id !== 'string') {
        return withCounts(
          fail('Invalid chart entry returned by chart().', logs),
        );
      }
      const v = ChartSpecSchema.safeParse(entry.spec);
      if (!v.success) {
        const m = v.error.issues.map((i) => i.message).join('; ');
        return withCounts(fail(`Invalid chart "${entry.id}": ${m}`, logs));
      }
      charts[entry.id] = v.data;
    }

    const content = sanitizeWidgetMarkdown(String(parsed.output ?? ''));
    if (!content.trim()) {
      return withCounts(
        fail('No output — render() returned an empty value.', logs),
      );
    }

    // Warn on registered-but-unreferenced charts.
    for (const id of Object.keys(charts)) {
      if (!content.includes(`id="${id}"`)) {
        warnings.push(
          `Chart "${id}" was created but not embedded in the output.`,
        );
      }
    }

    return withCounts({
      success: true,
      content,
      charts,
      logs,
      warnings: warnings.length ? warnings : undefined,
      sourcesFetched,
      totalSources,
    });
  } finally {
    release();
  }
}
