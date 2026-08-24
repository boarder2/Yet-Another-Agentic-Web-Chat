import { TERM_GRACE_MS } from './constants.ts';
import {
  validateOwnedProcess,
  type ProcessInspector,
  type ProcessValidation,
} from './ownership.ts';
import type { AppState } from './types.ts';

export interface TerminationResult {
  ok: boolean;
  refused?: string;
  escalated: boolean;
  groupGone: boolean;
}

export interface TerminationOptions {
  graceMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  validate?: () => Promise<ProcessValidation>;
}

export async function terminateOwnedGroup(
  state: AppState,
  inspector: ProcessInspector,
  options: TerminationOptions = {},
): Promise<TerminationResult> {
  const validation = options.validate
    ? await options.validate()
    : await defaultValidation(state, inspector);
  if (!validation.ok || !state.pgid) {
    return {
      ok: false,
      refused: validation.reason ?? 'process identity could not be validated',
      escalated: false,
      groupGone: false,
    };
  }

  const sleep = options.sleep ?? realSleep;
  const graceMs = options.graceMs ?? TERM_GRACE_MS;
  const pollMs = options.pollMs ?? 100;
  let escalated = false;

  try {
    inspector.signalGroup(state.pgid, 'SIGTERM');
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error;
  }

  if (await waitForGone(state.pgid, inspector, graceMs, pollMs, sleep)) {
    return { ok: true, escalated, groupGone: true };
  }

  escalated = true;
  try {
    inspector.signalGroup(state.pgid, 'SIGKILL');
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error;
  }
  const groupGone = await waitForGone(
    state.pgid,
    inspector,
    graceMs,
    pollMs,
    sleep,
  );
  return { ok: groupGone, escalated, groupGone };
}

function defaultValidation(
  state: AppState,
  inspector: ProcessInspector,
): Promise<ProcessValidation> {
  return validateOwnedProcess(state, inspector);
}

async function waitForGone(
  pgid: number,
  inspector: Pick<ProcessInspector, 'groupAlive'>,
  timeoutMs: number,
  pollMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (await inspector.groupAlive(pgid)) {
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  return true;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH';
}
