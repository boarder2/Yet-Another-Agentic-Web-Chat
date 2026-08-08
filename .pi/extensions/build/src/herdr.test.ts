import { describe, it, expect } from 'vitest';
import { errorCode, HerdrError, insideHerdr, isPaneBusy } from './herdr.ts';

describe('insideHerdr', () => {
  it('accepts only an explicit HERDR_ENV=1', () => {
    expect(insideHerdr({ HERDR_ENV: '1' })).toBe(true);
    expect(insideHerdr({ HERDR_ENV: '0' })).toBe(false);
    expect(insideHerdr({ HERDR_ENV: 'true' })).toBe(false);
    expect(insideHerdr({})).toBe(false);
  });
});

describe('errorCode', () => {
  it('reads the code a failed call reported', () => {
    expect(
      errorCode(
        '{"error":{"code":"agent_pane_busy","message":"not an available shell"}}',
      ),
    ).toBe('agent_pane_busy');
  });

  it('is null when there is no machine-readable code to branch on', () => {
    expect(errorCode('herdr: command not found')).toBeNull();
    expect(errorCode('{"error":{}}')).toBeNull();
    expect(errorCode('')).toBeNull();
  });
});

// A freshly split pane is not startable yet, and nothing observable says when it
// will be, so this refusal is the signal to wait and try again.
describe('isPaneBusy', () => {
  const failure = (stderr: string) =>
    new HerdrError(['agent', 'start'], 1, stderr);

  it('recognises the refusal worth retrying', () => {
    expect(
      isPaneBusy(
        failure(
          '{"error":{"code":"agent_pane_busy","message":"not an available shell"}}',
        ),
      ),
    ).toBe(true);
  });

  it('does not retry a name collision or a missing pane', () => {
    for (const code of ['agent_name_taken', 'pane_not_found']) {
      expect(isPaneBusy(failure(`{"error":{"code":"${code}"}}`)), code).toBe(
        false,
      );
    }
  });

  it('does not retry a failure that is not herdr refusing a pane', () => {
    expect(isPaneBusy(new Error('spawn herdr ENOENT'))).toBe(false);
    expect(isPaneBusy(undefined)).toBe(false);
  });
});
