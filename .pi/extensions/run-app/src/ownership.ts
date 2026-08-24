import { resolve } from 'node:path';
import type { AppState } from './types.ts';

export interface ProcessIdentity {
  pid: number;
  command: string;
  cwd?: string;
  token?: string;
  tokenReadable?: boolean;
  pgid?: number;
}

export interface ProcessInspector {
  inspect(pid: number): Promise<ProcessIdentity | null>;
  controllerAlive(pid: number): Promise<boolean>;
  groupAlive(pgid: number): Promise<boolean>;
  signalGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface ProcessValidation {
  ok: boolean;
  reason?: string;
  identity?: ProcessIdentity;
  identityVerified: boolean;
}

export async function validateOwnedProcess(
  state: AppState,
  inspector: Pick<ProcessInspector, 'inspect'>,
  options: { requireToken?: boolean } = {},
): Promise<ProcessValidation> {
  if (state.ownership !== 'owned') {
    return {
      ok: false,
      reason: 'state is not extension-owned',
      identityVerified: false,
    };
  }
  if (!state.pid || !state.pgid || !state.ownershipToken) {
    return {
      ok: false,
      reason: 'owned state has incomplete process identity',
      identityVerified: false,
    };
  }

  const identity = await inspector.inspect(state.pid);
  if (!identity) {
    return {
      ok: false,
      reason: 'recorded process is not alive',
      identityVerified: false,
    };
  }
  if (identity.pid !== state.pid) {
    return {
      ok: false,
      reason: 'recorded PID identity changed',
      identityVerified: false,
    };
  }
  if (!isDevCommand(identity.command)) {
    return {
      ok: false,
      reason: 'recorded PID is not npm run dev',
      identityVerified: false,
    };
  }
  if (identity.cwd && resolve(identity.cwd) !== resolve(state.cwd)) {
    return {
      ok: false,
      reason: 'recorded process cwd changed',
      identityVerified: false,
    };
  }
  if (identity.pgid !== undefined && identity.pgid !== state.pgid) {
    return {
      ok: false,
      reason: 'recorded process group changed',
      identityVerified: false,
    };
  }
  if (identity.tokenReadable && identity.token !== state.ownershipToken) {
    return {
      ok: false,
      reason: 'ownership token changed',
      identityVerified: false,
    };
  }
  if (options.requireToken && !identity.tokenReadable) {
    return {
      ok: false,
      reason: 'ownership token cannot be validated on this platform',
      identityVerified: false,
    };
  }

  return {
    ok: true,
    identity,
    identityVerified: identity.tokenReadable === true || Boolean(identity.cwd),
  };
}

export function isDevCommand(command: string): boolean {
  const normalized = command.toLowerCase().replaceAll('\\', '/');
  return /(?:^|\s|\/)(?:npm|npm\.cmd)(?:\s+[^\n]*?)?\brun\s+dev(?:\s|$)/.test(
    normalized,
  );
}

export type ControllerAccess = 'current' | 'foreign-live' | 'adoptable';

export async function controllerAccess(
  controllerPid: number | null,
  currentPid: number,
  controllerAlive: (pid: number) => Promise<boolean>,
): Promise<ControllerAccess> {
  if (controllerPid === currentPid) return 'current';
  if (controllerPid && (await controllerAlive(controllerPid)))
    return 'foreign-live';
  return 'adoptable';
}
