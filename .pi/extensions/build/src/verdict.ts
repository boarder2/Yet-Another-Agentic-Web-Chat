import { AGENT_ROLES, type AgentRole } from './models.ts';

export type ReviewOutcome = 'pass' | 'changes-required' | 'needs-replan';
export type TestOutcome = 'passed' | 'failed' | 'blocked' | 'needs-replan';
export type CompletionOutcome = 'completed' | 'blocked' | 'needs-replan';

export interface ReviewVerdict {
  verdict: ReviewOutcome;
  blocking: string[];
  notes: string;
  rationale: string;
}

export interface TestResult {
  outcome: TestOutcome;
  passed: number;
  failed: number;
  output: string;
  rationale: string;
}

export interface CoderCompletion {
  status: CompletionOutcome;
  summary: string;
  rationale: string;
}

export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };

export const VERDICT_TOOL = 'submit_verdict';
export const TEST_RESULT_TOOL = 'submit_test_result';
export const COMPLETION_TOOL = 'submit_completion';

export const REPORT_TOOL_BY_ROLE = {
  coder: COMPLETION_TOOL,
  tester: TEST_RESULT_TOOL,
  reviewer: VERDICT_TOOL,
} as const satisfies Record<AgentRole, string>;

export const BUILD_ROLE_ENV = 'PI_BUILD_EXT_ROLE';
export const RESULT_FILE_ENV = 'YAAWC_BUILD_RESULT';

export function parseBuildRole(value: string | undefined): AgentRole | null {
  return AGENT_ROLES.includes(value as AgentRole) ? (value as AgentRole) : null;
}

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
  if (!envelope) return { ok: false, reason: `The ${role} never called ${tool}.` };
  if (envelope.kind !== tool) {
    return {
      ok: false,
      reason: `Expected ${tool} from the ${role} but found ${envelope.kind}.`,
    };
  }
  return { ok: true, value: envelope.payload };
}

function needsRationale(outcome: string): boolean {
  return outcome === 'blocked' || outcome === 'needs-replan';
}

export function decodeVerdict(
  envelope: ResultEnvelope | null,
): Decoded<ReviewVerdict> {
  const found = payloadFor(envelope, VERDICT_TOOL, 'reviewer');
  if (!found.ok) return found;
  const args = found.value;
  const verdict = args.verdict;
  if (verdict !== 'pass' && verdict !== 'changes-required' && verdict !== 'needs-replan') {
    return {
      ok: false,
      reason: `${VERDICT_TOOL} reported an unreadable verdict: ${JSON.stringify(verdict)}.`,
    };
  }

  const blocking = asStrings(args.blocking);
  const rationale = asText(args.rationale).trim();
  if (verdict === 'pass' && blocking.length > 0) {
    return {
      ok: false,
      reason: `${VERDICT_TOOL} reported pass with blocking findings.`,
    };
  }
  if (verdict !== 'pass' && blocking.length === 0) {
    return {
      ok: false,
      reason: `${VERDICT_TOOL} reported ${verdict} with no blocking findings.`,
    };
  }
  if (verdict === 'needs-replan' && !rationale) {
    return {
      ok: false,
      reason: `${VERDICT_TOOL} reported needs-replan with no rationale.`,
    };
  }

  return {
    ok: true,
    value: {
      verdict,
      blocking,
      notes: asText(args.notes),
      rationale,
    },
  };
}

export function decodeTestResult(
  envelope: ResultEnvelope | null,
): Decoded<TestResult> {
  const found = payloadFor(envelope, TEST_RESULT_TOOL, 'tester');
  if (!found.ok) return found;
  const { outcome, passed, failed, output } = found.value;
  if (!['passed', 'failed', 'blocked', 'needs-replan'].includes(String(outcome))) {
    return {
      ok: false,
      reason: `${TEST_RESULT_TOOL} reported an unreadable outcome: ${JSON.stringify(outcome)}.`,
    };
  }
  if (
    typeof passed !== 'number' || !Number.isInteger(passed) || passed < 0 ||
    typeof failed !== 'number' || !Number.isInteger(failed) || failed < 0
  ) {
    return { ok: false, reason: `${TEST_RESULT_TOOL} reported unreadable counts.` };
  }
  const rationale = asText(found.value.rationale).trim();
  if (needsRationale(String(outcome)) && !rationale) {
    return {
      ok: false,
      reason: `${TEST_RESULT_TOOL} reported ${outcome} with no rationale.`,
    };
  }

  return {
    ok: true,
    value: {
      outcome: outcome as TestOutcome,
      passed,
      failed,
      output: asText(output),
      rationale,
    },
  };
}

export function decodeCompletion(
  envelope: ResultEnvelope | null,
): Decoded<CoderCompletion> {
  const found = payloadFor(envelope, COMPLETION_TOOL, 'coder');
  if (!found.ok) return found;
  const { status, summary } = found.value;
  if (status !== 'completed' && status !== 'blocked' && status !== 'needs-replan') {
    return {
      ok: false,
      reason: `${COMPLETION_TOOL} reported an unreadable status: ${JSON.stringify(status)}.`,
    };
  }
  const rationale = asText(found.value.rationale).trim();
  if (needsRationale(status) && !rationale) {
    return {
      ok: false,
      reason: `${COMPLETION_TOOL} reported ${status} with no rationale.`,
    };
  }
  return {
    ok: true,
    value: { status, summary: asText(summary), rationale },
  };
}

export function isGreen(result: TestResult): boolean {
  return result.outcome === 'passed' && result.failed === 0 && result.passed > 0;
}
