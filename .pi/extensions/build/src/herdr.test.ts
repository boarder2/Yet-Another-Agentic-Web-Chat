import { describe, it, expect } from 'vitest';
import { errorCode, insideHerdr, isAvailableShell } from './herdr.ts';

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

// `agent start` refuses a pane that is not at its shell prompt, which is what made
// a freshly split pane fail: the shell had not taken the foreground yet.
describe('isAvailableShell', () => {
  it('is available when the shell itself is the foreground process group', () => {
    expect(
      isAvailableShell({ shell_pid: 86275, foreground_process_group_id: 86275 }),
    ).toBe(true);
  });

  it('is busy while any command holds the foreground', () => {
    expect(
      isAvailableShell({ shell_pid: 86275, foreground_process_group_id: 86521 }),
    ).toBe(false);
  });

  it('is busy when the pane has no shell to report yet', () => {
    expect(isAvailableShell({})).toBe(false);
    expect(isAvailableShell({ foreground_process_group_id: 42 })).toBe(false);
  });
});
