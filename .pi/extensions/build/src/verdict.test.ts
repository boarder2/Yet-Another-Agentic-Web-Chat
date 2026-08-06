import { describe, it, expect } from 'vitest';
import {
  decodeTestResult,
  decodeVerdict,
  isGreen,
  TEST_RESULT_TOOL,
  VERDICT_TOOL,
} from './verdict.ts';

const call = (toolName: string, args: unknown) => ({ toolName, args });

describe('decodeVerdict', () => {
  it('decodes a pass', () => {
    const decoded = decodeVerdict([call(VERDICT_TOOL, { verdict: 'pass', blocking: [] })]);
    expect(decoded).toEqual({ ok: true, value: { verdict: 'pass', blocking: [] } });
  });

  it('decodes changes-required with its findings', () => {
    const decoded = decodeVerdict([
      call(VERDICT_TOOL, {
        verdict: 'changes-required',
        blocking: ['a.ts:1 — null deref'],
      }),
    ]);
    expect(decoded).toEqual({
      ok: true,
      value: { verdict: 'changes-required', blocking: ['a.ts:1 — null deref'] },
    });
  });

  it('fails closed when the reviewer never reported', () => {
    expect(decodeVerdict([])).toMatchObject({ ok: false });
    expect(decodeVerdict([call('bash', { command: 'ls' })])).toMatchObject({
      ok: false,
    });
  });

  it('fails closed on a hedged or malformed verdict rather than guessing', () => {
    for (const verdict of ['mostly passes', '', 'PASS', null, 42]) {
      expect(
        decodeVerdict([call(VERDICT_TOOL, { verdict, blocking: [] })]),
        String(verdict),
      ).toMatchObject({ ok: false });
    }
  });

  it('rejects changes-required with no findings, which cannot be acted on', () => {
    expect(
      decodeVerdict([call(VERDICT_TOOL, { verdict: 'changes-required', blocking: [] })]),
    ).toMatchObject({ ok: false });
  });

  it('uses the last report when a tool is called more than once', () => {
    const decoded = decodeVerdict([
      call(VERDICT_TOOL, { verdict: 'changes-required', blocking: ['x'] }),
      call(VERDICT_TOOL, { verdict: 'pass', blocking: [] }),
    ]);
    expect(decoded).toMatchObject({ ok: true, value: { verdict: 'pass' } });
  });
});

describe('decodeTestResult', () => {
  it('decodes counts and output', () => {
    expect(
      decodeTestResult([
        call(TEST_RESULT_TOOL, { passed: 12, failed: 0, output: 'all good' }),
      ]),
    ).toEqual({ ok: true, value: { passed: 12, failed: 0, output: 'all good' } });
  });

  it('fails closed when the tester never reported or reported junk', () => {
    expect(decodeTestResult([])).toMatchObject({ ok: false });
    expect(
      decodeTestResult([call(TEST_RESULT_TOOL, { passed: 'lots', failed: 0 })]),
    ).toMatchObject({ ok: false });
  });

  it('tolerates a missing output string', () => {
    expect(
      decodeTestResult([call(TEST_RESULT_TOOL, { passed: 1, failed: 0 })]),
    ).toEqual({ ok: true, value: { passed: 1, failed: 0, output: '' } });
  });
});

describe('isGreen', () => {
  it('requires passing tests, not merely an absence of failures', () => {
    expect(isGreen({ passed: 3, failed: 0, output: '' })).toBe(true);
    expect(isGreen({ passed: 0, failed: 0, output: '' })).toBe(false);
    expect(isGreen({ passed: 9, failed: 1, output: '' })).toBe(false);
  });
});
