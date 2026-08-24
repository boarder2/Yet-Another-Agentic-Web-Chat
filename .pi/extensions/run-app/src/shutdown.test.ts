import { describe, expect, it } from 'vitest';
import { terminateOwnedGroup } from './shutdown.ts';
import { stoppedState } from './types.ts';

const state = {
  ...stoppedState('/tmp/project', '/tmp/log'),
  lifecycle: 'running' as const,
  ownership: 'owned' as const,
  pid: 41,
  pgid: 41,
  ownershipToken: 'token',
};

describe('owned process shutdown', () => {
  it('sends SIGTERM first and escalates to SIGKILL after the grace period', async () => {
    const signals: string[] = [];
    let checks = 0;
    const result = await terminateOwnedGroup(
      state,
      {
        inspect: async () => null,
        controllerAlive: async () => true,
        groupAlive: async () => {
          checks++;
          return checks === 1;
        },
        signalGroup: (_pgid, signal) => signals.push(signal),
      },
      {
        graceMs: 0,
        pollMs: 1,
        sleep: async () => undefined,
        validate: async () => ({ ok: true, identityVerified: true }),
      },
    );

    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(result).toMatchObject({
      ok: true,
      escalated: true,
      groupGone: true,
    });
  });

  it('refuses to signal when validation fails', async () => {
    const signals: string[] = [];
    const result = await terminateOwnedGroup(
      state,
      {
        inspect: async () => null,
        controllerAlive: async () => true,
        groupAlive: async () => true,
        signalGroup: (_pgid, signal) => signals.push(signal),
      },
      {
        validate: async () => ({
          ok: false,
          reason: 'PID reuse',
          identityVerified: false,
        }),
      },
    );
    expect(result).toMatchObject({ ok: false, refused: 'PID reuse' });
    expect(signals).toEqual([]);
  });
});
