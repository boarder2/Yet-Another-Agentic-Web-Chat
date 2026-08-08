import { describe, it, expect } from 'vitest';
import {
  COMPLETION_TOOL,
  decodeCompletion,
  decodeTestResult,
  decodeVerdict,
  isGreen,
  parseResult,
  serializeResult,
  TEST_RESULT_TOOL,
  VERDICT_TOOL,
  type ResultEnvelope,
} from './verdict.ts';

/** What the loop actually reads: the file a subagent's submit tool wrote. */
const reported = (
  kind: string,
  payload: Record<string, unknown>,
): ResultEnvelope | null => parseResult(serializeResult(kind, payload));

describe('parseResult', () => {
  it('round-trips a written result', () => {
    expect(reported(VERDICT_TOOL, { verdict: 'pass' })).toEqual({
      kind: VERDICT_TOOL,
      payload: { verdict: 'pass' },
    });
  });

  it('reads an absent or unparseable file as no report at all', () => {
    expect(parseResult(null)).toBeNull();
    expect(parseResult('not json')).toBeNull();
    expect(parseResult('{"kind":"x"}')).toBeNull();
  });
});

describe('decodeVerdict', () => {
  it('decodes a pass', () => {
    expect(
      decodeVerdict(
        reported(VERDICT_TOOL, { verdict: 'pass', blocking: [], notes: '' }),
      ),
    ).toEqual({
      ok: true,
      value: { verdict: 'pass', blocking: [], notes: '' },
    });
  });

  it('decodes changes-required with its findings and reasoning', () => {
    expect(
      decodeVerdict(
        reported(VERDICT_TOOL, {
          verdict: 'changes-required',
          blocking: ['a.ts:1 — null deref'],
          notes: 'the guard is on the wrong side',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        verdict: 'changes-required',
        blocking: ['a.ts:1 — null deref'],
        notes: 'the guard is on the wrong side',
      },
    });
  });

  it('fails closed when the reviewer never reported', () => {
    expect(decodeVerdict(null)).toMatchObject({ ok: false });
  });

  it('fails closed when the file holds another role’s result', () => {
    expect(
      decodeVerdict(reported(TEST_RESULT_TOOL, { passed: 1, failed: 0 })),
    ).toMatchObject({ ok: false });
  });

  it('fails closed on a hedged or malformed verdict rather than guessing', () => {
    for (const verdict of ['mostly passes', '', 'PASS', null, 42]) {
      expect(
        decodeVerdict(reported(VERDICT_TOOL, { verdict, blocking: [] })),
        String(verdict),
      ).toMatchObject({ ok: false });
    }
  });

  it('rejects changes-required with no findings, which cannot be acted on', () => {
    expect(
      decodeVerdict(
        reported(VERDICT_TOOL, { verdict: 'changes-required', blocking: [] }),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe('decodeTestResult', () => {
  it('decodes counts and output', () => {
    expect(
      decodeTestResult(
        reported(TEST_RESULT_TOOL, {
          passed: 12,
          failed: 0,
          output: 'all good',
        }),
      ),
    ).toEqual({
      ok: true,
      value: { passed: 12, failed: 0, output: 'all good' },
    });
  });

  it('fails closed when the tester never reported or reported junk', () => {
    expect(decodeTestResult(null)).toMatchObject({ ok: false });
    expect(
      decodeTestResult(
        reported(TEST_RESULT_TOOL, { passed: 'lots', failed: 0 }),
      ),
    ).toMatchObject({ ok: false });
  });

  it('tolerates a missing output string', () => {
    expect(
      decodeTestResult(reported(TEST_RESULT_TOOL, { passed: 1, failed: 0 })),
    ).toEqual({ ok: true, value: { passed: 1, failed: 0, output: '' } });
  });
});

describe('decodeCompletion', () => {
  it('decodes a finished chunk', () => {
    expect(
      decodeCompletion(
        reported(COMPLETION_TOOL, {
          status: 'completed',
          summary: 'added the parser',
        }),
      ),
    ).toEqual({
      ok: true,
      value: { status: 'completed', summary: 'added the parser' },
    });
  });

  it('decodes a coder that gave up, so the loop can stop early', () => {
    expect(
      decodeCompletion(
        reported(COMPLETION_TOOL, {
          status: 'blocked',
          summary: 'chunk 3 contradicts the plan',
        }),
      ),
    ).toMatchObject({ ok: true, value: { status: 'blocked' } });
  });

  it('fails closed when the coder never reported or hedged its status', () => {
    expect(decodeCompletion(null)).toMatchObject({ ok: false });
    for (const status of ['done', 'mostly', '', null]) {
      expect(
        decodeCompletion(reported(COMPLETION_TOOL, { status })),
        String(status),
      ).toMatchObject({ ok: false });
    }
  });
});

describe('isGreen', () => {
  it('requires passing tests, not merely an absence of failures', () => {
    expect(isGreen({ passed: 3, failed: 0, output: '' })).toBe(true);
    expect(isGreen({ passed: 0, failed: 0, output: '' })).toBe(false);
    expect(isGreen({ passed: 9, failed: 1, output: '' })).toBe(false);
  });
});
