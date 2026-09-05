import { describe, expect, it } from 'vitest';
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

  it('reads absent or malformed content as no report', () => {
    expect(parseResult(null)).toBeNull();
    expect(parseResult('not json')).toBeNull();
    expect(parseResult('{"kind":"x"}')).toBeNull();
  });
});

describe('decodeVerdict', () => {
  it('decodes pass and implementation findings', () => {
    expect(decodeVerdict(reported(VERDICT_TOOL, {
      verdict: 'pass', blocking: [], notes: '', rationale: '',
    }))).toEqual({
      ok: true,
      value: { verdict: 'pass', blocking: [], notes: '', rationale: '' },
    });
    expect(decodeVerdict(reported(VERDICT_TOOL, {
      verdict: 'changes-required',
      blocking: ['a.ts:1 — null deref'],
      notes: 'guard is misplaced',
      rationale: '',
    }))).toMatchObject({
      ok: true,
      value: { verdict: 'changes-required', blocking: ['a.ts:1 — null deref'] },
    });
  });

  it('decodes a concrete design blocker', () => {
    expect(decodeVerdict(reported(VERDICT_TOOL, {
      verdict: 'needs-replan',
      blocking: ['schema.ts:4 — migration drops existing rows'],
      notes: '',
      rationale: 'The approved migration strategy cannot preserve rows.',
    }))).toMatchObject({
      ok: true,
      value: { verdict: 'needs-replan' },
    });
  });

  it('fails closed on missing, hedged, or evidence-free verdicts', () => {
    expect(decodeVerdict(null)).toMatchObject({ ok: false });
    expect(decodeVerdict(reported(TEST_RESULT_TOOL, {}))).toMatchObject({ ok: false });
    expect(decodeVerdict(reported(VERDICT_TOOL, { verdict: 'PASS', blocking: [] })))
      .toMatchObject({ ok: false });
    expect(decodeVerdict(reported(VERDICT_TOOL, {
      verdict: 'pass', blocking: ['a.ts:1 — defect'], notes: '', rationale: '',
    }))).toMatchObject({ ok: false });
    expect(decodeVerdict(reported(VERDICT_TOOL, {
      verdict: 'changes-required', blocking: [], notes: '', rationale: '',
    }))).toMatchObject({ ok: false });
    expect(decodeVerdict(reported(VERDICT_TOOL, {
      verdict: 'needs-replan', blocking: ['x'], notes: '', rationale: '',
    }))).toMatchObject({ ok: false });
  });
});

describe('decodeTestResult', () => {
  it('decodes observed outcomes and counts', () => {
    expect(decodeTestResult(reported(TEST_RESULT_TOOL, {
      outcome: 'passed', passed: 12, failed: 0, output: 'all good', rationale: '',
    }))).toEqual({
      ok: true,
      value: {
        outcome: 'passed', passed: 12, failed: 0, output: 'all good', rationale: '',
      },
    });
  });

  it('requires rationale for blocked and design outcomes', () => {
    expect(decodeTestResult(reported(TEST_RESULT_TOOL, {
      outcome: 'needs-replan', passed: 0, failed: 1, output: 'unsafe', rationale: 'contract conflicts',
    }))).toMatchObject({ ok: true, value: { outcome: 'needs-replan' } });
    expect(decodeTestResult(reported(TEST_RESULT_TOOL, {
      outcome: 'blocked', passed: 0, failed: 0, output: '', rationale: '',
    }))).toMatchObject({ ok: false });
  });

  it('fails closed on missing outcomes or invalid counts', () => {
    expect(decodeTestResult(null)).toMatchObject({ ok: false });
    expect(decodeTestResult(reported(TEST_RESULT_TOOL, {
      outcome: 'passed', passed: 'lots', failed: 0,
    }))).toMatchObject({ ok: false });
    expect(decodeTestResult(reported(TEST_RESULT_TOOL, {
      outcome: 'passed', passed: 0.5, failed: 0, rationale: '',
    }))).toMatchObject({ ok: false });
  });
});

describe('decodeCompletion', () => {
  it('decodes completion and design blockers', () => {
    expect(decodeCompletion(reported(COMPLETION_TOOL, {
      status: 'completed', summary: 'added parser', rationale: '',
    }))).toEqual({
      ok: true,
      value: { status: 'completed', summary: 'added parser', rationale: '' },
    });
    expect(decodeCompletion(reported(COMPLETION_TOOL, {
      status: 'needs-replan', summary: 'schema conflict', rationale: 'field cannot be nullable',
    }))).toMatchObject({ ok: true, value: { status: 'needs-replan' } });
  });

  it('requires rationale for blockers and rejects hedged status', () => {
    expect(decodeCompletion(reported(COMPLETION_TOOL, {
      status: 'blocked', summary: 'cannot run generator', rationale: '',
    }))).toMatchObject({ ok: false });
    expect(decodeCompletion(reported(COMPLETION_TOOL, { status: 'mostly' })))
      .toMatchObject({ ok: false });
  });
});

describe('isGreen', () => {
  const result = (outcome: 'passed' | 'failed', passed: number, failed: number) => ({
    outcome,
    passed,
    failed,
    output: '',
    rationale: '',
  });

  it('requires an explicit pass, at least one passing test, and zero failures', () => {
    expect(isGreen(result('passed', 3, 0))).toBe(true);
    expect(isGreen(result('passed', 0, 0))).toBe(false);
    expect(isGreen(result('passed', 9, 1))).toBe(false);
    expect(isGreen(result('failed', 9, 0))).toBe(false);
  });
});
