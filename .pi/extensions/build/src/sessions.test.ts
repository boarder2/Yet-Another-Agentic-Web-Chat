import { describe, it, expect } from 'vitest';
import { maxTotalTokens, sessionsDir } from './sessions.ts';

describe('sessionsDir', () => {
  it('mirrors pi’s per-project directory naming', () => {
    expect(sessionsDir('/workspaces/YAAWC', '/home/node')).toBe(
      '/home/node/.pi/agent/sessions/--workspaces-YAAWC-',
    );
  });
});

describe('maxTotalTokens', () => {
  const line = (totalTokens: unknown) =>
    JSON.stringify({ type: 'message', message: { usage: { totalTokens } } });

  it('takes the high-water mark across the session', () => {
    expect(maxTotalTokens([line(120), line(4000), line(900)].join('\n'))).toBe(
      4000,
    );
  });

  it('ignores blank lines, unparseable lines and entries with no usage', () => {
    const jsonl = ['', 'not json', '{"type":"session"}', line(77), ''].join(
      '\n',
    );
    expect(maxTotalTokens(jsonl)).toBe(77);
  });

  it('reads a session with no usage as zero, which never triggers a reseed', () => {
    expect(maxTotalTokens('')).toBe(0);
    expect(maxTotalTokens(line('lots'))).toBe(0);
  });
});
