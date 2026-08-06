export interface ReviewVerdict {
  verdict: 'pass' | 'changes-required';
  blocking: string[];
}

export interface TestResult {
  passed: number;
  failed: number;
  output: string;
}

export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };

export const VERDICT_TOOL = 'submit_verdict';
export const TEST_RESULT_TOOL = 'submit_test_result';

export interface ToolCallRecord {
  toolName: string;
  args: unknown;
}

function lastCall(
  calls: readonly ToolCallRecord[],
  name: string,
): Record<string, unknown> | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (
      calls[i].toolName === name &&
      calls[i].args &&
      typeof calls[i].args === 'object'
    ) {
      return calls[i].args as Record<string, unknown>;
    }
  }
  return null;
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

// Fail-closed throughout: a missing or unreadable signal is never a pass, and is
// never silently coerced into one.
export function decodeVerdict(
  calls: readonly ToolCallRecord[],
): Decoded<ReviewVerdict> {
  const args = lastCall(calls, VERDICT_TOOL);
  if (!args) {
    return { ok: false, reason: `The reviewer never called ${VERDICT_TOOL}.` };
  }

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

  return { ok: true, value: { verdict, blocking } };
}

export function decodeTestResult(
  calls: readonly ToolCallRecord[],
): Decoded<TestResult> {
  const args = lastCall(calls, TEST_RESULT_TOOL);
  if (!args) {
    return {
      ok: false,
      reason: `The tester never called ${TEST_RESULT_TOOL}.`,
    };
  }

  const { passed, failed, output } = args;
  if (typeof passed !== 'number' || typeof failed !== 'number') {
    return {
      ok: false,
      reason: `${TEST_RESULT_TOOL} reported unreadable counts.`,
    };
  }

  return {
    ok: true,
    value: {
      passed,
      failed,
      output: typeof output === 'string' ? output : '',
    },
  };
}

export function isGreen(result: TestResult): boolean {
  return result.failed === 0 && result.passed > 0;
}
