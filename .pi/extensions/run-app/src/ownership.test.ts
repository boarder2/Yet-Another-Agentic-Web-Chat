import { describe, expect, it } from 'vitest';
import {
  controllerAccess,
  isDevCommand,
  validateOwnedProcess,
  type ProcessIdentity,
} from './ownership.ts';
import { stoppedState } from './types.ts';

const state = {
  ...stoppedState('/tmp/project', '/tmp/log'),
  lifecycle: 'running' as const,
  ownership: 'owned' as const,
  pid: 41,
  pgid: 41,
  ownershipToken: 'token',
  controllerPid: 7,
  cwd: '/tmp/project',
};

const identity: ProcessIdentity = {
  pid: 41,
  pgid: 41,
  command: 'npm run dev',
  cwd: '/tmp/project',
  token: 'token',
  tokenReadable: true,
};

describe('process identity', () => {
  it('accepts npm run dev and rejects unrelated PID reuse', async () => {
    expect(isDevCommand('npm run dev')).toBe(true);
    expect(isDevCommand('/usr/bin/npm run dev')).toBe(true);
    expect(isDevCommand('node unrelated.js')).toBe(false);
    await expect(
      validateOwnedProcess(state, { inspect: async () => identity }),
    ).resolves.toMatchObject({
      ok: true,
      identityVerified: true,
    });
    await expect(
      validateOwnedProcess(state, {
        inspect: async () => ({ ...identity, token: 'other' }),
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe('controller ownership', () => {
  it('protects a live controller and permits adoption only after it dies', async () => {
    await expect(controllerAccess(10, 20, async () => true)).resolves.toBe(
      'foreign-live',
    );
    await expect(controllerAccess(10, 20, async () => false)).resolves.toBe(
      'adoptable',
    );
    await expect(controllerAccess(20, 20, async () => true)).resolves.toBe(
      'current',
    );
  });
});
