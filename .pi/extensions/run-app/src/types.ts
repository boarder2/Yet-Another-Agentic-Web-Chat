import type { STATE_VERSION } from './constants.ts';

export type Ownership = 'owned' | 'external' | 'none';
export type Lifecycle = 'stopped' | 'starting' | 'running' | 'stale';
export type Health = 'unknown' | 'healthy' | 'unhealthy';

export interface AppState {
  version: typeof STATE_VERSION;
  lifecycle: Lifecycle;
  ownership: Ownership;
  pid: number | null;
  pgid: number | null;
  ownershipToken: string | null;
  controllerPid: number | null;
  cwd: string;
  port: number | null;
  url: string | null;
  dataDir: string | null;
  logPath: string;
  tailPaneId: string | null;
  health: Health;
  consecutiveFailures: number;
  startedAt: string | null;
  stoppedAt: string | null;
  staleReason: string | null;
}

const LIFECYCLES: readonly Lifecycle[] = [
  'stopped',
  'starting',
  'running',
  'stale',
];
const OWNERSHIPS: readonly Ownership[] = ['owned', 'external', 'none'];
const HEALTHS: readonly Health[] = ['unknown', 'healthy', 'unhealthy'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string';
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : (value as string);
}

function isNullablePositiveInt(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

function nullablePositiveInt(value: unknown): number | null {
  return value === null || value === undefined ? null : (value as number);
}

function isNullablePort(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65_535)
  );
}

function nullablePort(value: unknown): number | null {
  return value === null || value === undefined ? null : (value as number);
}

export function parseAppState(value: unknown): AppState | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (
    !LIFECYCLES.includes(value.lifecycle as Lifecycle) ||
    !OWNERSHIPS.includes(value.ownership as Ownership) ||
    !HEALTHS.includes(value.health as Health) ||
    typeof value.cwd !== 'string' ||
    typeof value.logPath !== 'string' ||
    !isNullablePositiveInt(value.pid) ||
    !isNullablePositiveInt(value.pgid) ||
    !isNullableString(value.ownershipToken) ||
    !isNullablePositiveInt(value.controllerPid) ||
    !isNullablePort(value.port) ||
    !isNullableString(value.url) ||
    !isNullableString(value.dataDir) ||
    !isNullableString(value.tailPaneId) ||
    !isNullableString(value.startedAt) ||
    !isNullableString(value.stoppedAt) ||
    !isNullableString(value.staleReason)
  ) {
    return null;
  }

  const failures = value.consecutiveFailures;
  if (
    typeof failures !== 'number' ||
    !Number.isSafeInteger(failures) ||
    failures < 0
  ) {
    return null;
  }

  const state: AppState = {
    version: 1,
    lifecycle: value.lifecycle as Lifecycle,
    ownership: value.ownership as Ownership,
    pid: nullablePositiveInt(value.pid),
    pgid: nullablePositiveInt(value.pgid),
    ownershipToken: nullableString(value.ownershipToken),
    controllerPid: nullablePositiveInt(value.controllerPid),
    cwd: value.cwd,
    port: nullablePort(value.port),
    url: nullableString(value.url),
    dataDir: nullableString(value.dataDir),
    logPath: value.logPath,
    tailPaneId: nullableString(value.tailPaneId),
    health: value.health as Health,
    consecutiveFailures: failures,
    startedAt: nullableString(value.startedAt),
    stoppedAt: nullableString(value.stoppedAt),
    staleReason: nullableString(value.staleReason),
  };

  if (
    state.ownership === 'owned' &&
    (!state.pid || !state.pgid || !state.ownershipToken)
  ) {
    if (state.lifecycle !== 'stopped') return null;
  }
  if (state.lifecycle === 'starting' || state.lifecycle === 'running') {
    if (state.ownership === 'none') return null;
    if (
      state.ownership === 'owned' &&
      (!state.pid ||
        !state.pgid ||
        !state.ownershipToken ||
        !state.controllerPid)
    ) {
      return null;
    }
    if (state.ownership === 'external' && (!state.port || !state.url))
      return null;
  }
  if (state.lifecycle === 'running' && !state.url && state.port !== null)
    return null;
  return state;
}

export function stoppedState(cwd: string, logPath: string): AppState {
  return {
    version: 1,
    lifecycle: 'stopped',
    ownership: 'none',
    pid: null,
    pgid: null,
    ownershipToken: null,
    controllerPid: null,
    cwd,
    port: null,
    url: null,
    dataDir: null,
    logPath,
    tailPaneId: null,
    health: 'unknown',
    consecutiveFailures: 0,
    startedAt: null,
    stoppedAt: null,
    staleReason: null,
  };
}

export function staleState(state: AppState, reason: string): AppState {
  return {
    ...state,
    lifecycle: 'stale',
    health: 'unhealthy',
    consecutiveFailures: Math.max(2, state.consecutiveFailures),
    staleReason: reason,
  };
}

export function stoppedFrom(
  state: AppState,
  reason?: string,
  at = new Date(),
): AppState {
  return {
    ...state,
    lifecycle: 'stopped',
    ownership: 'none',
    pid: null,
    pgid: null,
    ownershipToken: null,
    controllerPid: null,
    health: 'unknown',
    consecutiveFailures: 0,
    stoppedAt: at.toISOString(),
    staleReason: reason ?? state.staleReason,
  };
}
