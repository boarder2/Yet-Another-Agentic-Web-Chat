/**
 * The typed signals every role reports through. Interactive agents own their own
 * terminal, so the parent cannot read their stdout: each submit tool writes its
 * payload to the file named by `YAAWC_BUILD_RESULT` and the loop decodes that.
 *
 * Fail-closed throughout — a missing, stale, or unreadable signal is a failure
 * with its reason, never coerced into a pass.
 */
export interface ReviewVerdict {
  verdict: 'pass' | 'changes-required';
  blocking: string[];
  notes: string;
}

export interface TestResult {
  passed: number;
  failed: number;
  output: string;
}

export interface CoderCompletion {
  status: 'completed' | 'blocked';
  summary: string;
}

export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };

export const VERDICT_TOOL = 'submit_verdict';
export const TEST_RESULT_TOOL = 'submit_test_result';
export const COMPLETION_TOOL = 'submit_completion';

/** Env var naming the file a subagent writes its typed result to. */
export const RESULT_FILE_ENV = 'YAAWC_BUILD_RESULT';

export interface ResultEnvelope {
  kind: string;
  payload: Record<string, unknown>;
}

export function serializeResult(
  kind: string,
  payload: Record<string, unknown>,
): string {
  return `${JSON.stringify({ kind, payload }, null, 2)}\n`;
}

/** `null` when the file was absent — the agent never reported at all. */
export function parseResult(text: string | null): ResultEnvelope | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Partial<ResultEnvelope>;
    if (typeof raw?.kind !== 'string' || typeof raw.payload !== 'object') {
      return null;
    }
    return { kind: raw.kind, payload: (raw.payload ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

function payloadFor(
  envelope: ResultEnvelope | null,
  tool: string,
  role: string,
): Decoded<Record<string, unknown>> {
  if (!envelope) {
    return { ok: false, reason: `The ${role} never called ${tool}.` };
  }
  if (envelope.kind !== tool) {
    return {
      ok: false,
      reason: `Expected ${tool} from the ${role} but found ${envelope.kind}.`,
    };
  }
  return { ok: true, value: envelope.payload };
}

export function decodeVerdict(
  envelope: ResultEnvelope | null,
): Decoded<ReviewVerdict> {
  const found = payloadFor(envelope, VERDICT_TOOL, 'reviewer');
  if (!found.ok) return found;
  const args = found.value;

  const verdict = args.verdict;
  if (verdict !== 'pass' && verdict !== 'changes-required') {
    return {
      ok: false,
      reason: `${VERDICT_TOOL} reported an unreadable verdict: ${JSON.stringify(verdict)}.`,
    };
  }

  const blocking = asStrings(args.blocking);
  if (verdict === 'changes-required' && blocking.length === 0) {
    return {
      ok: false,
      reason: `${VERDICT_TOOL} reported changes-required with no blocking findings.`,
    };
  }

  return {
    ok: true,
    value: { verdict, blocking, notes: asText(args.notes) },
  };
}

export function decodeTestResult(
  envelope: ResultEnvelope | null,
): Decoded<TestResult> {
  const found = payloadFor(envelope, TEST_RESULT_TOOL, 'tester');
  if (!found.ok) return found;
  const { passed, failed, output } = found.value;

  if (typeof passed !== 'number' || typeof failed !== 'number') {
    return {
      ok: false,
      reason: `${TEST_RESULT_TOOL} reported unreadable counts.`,
    };
  }

  return { ok: true, value: { passed, failed, output: asText(output) } };
}

export function decodeCompletion(
  envelope: ResultEnvelope | null,
): Decoded<CoderCompletion> {
  const found = payloadFor(envelope, COMPLETION_TOOL, 'coder');
  if (!found.ok) return found;
  const { status, summary } = found.value;

  if (status !== 'completed' && status !== 'blocked') {
    return {
      ok: false,
      reason: `${COMPLETION_TOOL} reported an unreadable status: ${JSON.stringify(status)}.`,
    };
  }

  return { ok: true, value: { status, summary: asText(summary) } };
}

export function isGreen(result: TestResult): boolean {
  return result.failed === 0 && result.passed > 0;
}
