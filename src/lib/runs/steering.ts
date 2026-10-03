import crypto from 'crypto';
import { getRun, pushEvent, type Run } from './runHub';
import type { RunClock } from '@/lib/clock';

export type Steer = Run['steers'][number];

/** Queue a steer on a steerable, live run; `null` once it can no longer take one. */
export function enqueueSteer(
  run: Run,
  content: string,
  clock: RunClock,
): Steer | null {
  if (
    !run.followup ||
    run.steersClosed ||
    (run.status !== 'running' && run.status !== 'awaiting_user')
  ) {
    return null;
  }
  const steer = { id: crypto.randomBytes(7).toString('hex'), content, clock };
  run.steers.push(steer);
  pushEvent(run, {
    type: 'steer_queued',
    data: { steerId: steer.id, content },
  });
  return steer;
}

/** Withdraw a queued steer; `false` once the agent or a follow-up turn took it. */
export function removeSteer(run: Run, steerId: string): boolean {
  const index = run.steers.findIndex((s) => s.id === steerId);
  if (index === -1) return false;
  run.steers.splice(index, 1);
  pushEvent(run, { type: 'steer_removed', data: { steerId } });
  return true;
}

/** Hand every queued steer to the agent of the run keyed by `messageId`. */
export function drainSteers(messageId: string): Steer[] {
  const run = getRun(messageId);
  if (!run || run.steersClosed) return [];
  return run.steers.splice(0);
}

/**
 * Stop accepting steers and delivering them to the agent. Steers already queued
 * stay removable until {@link takeSteers}.
 */
export function closeSteers(run: Run): void {
  run.steersClosed = true;
}

/** Close steering and take the steers the agent never received. */
export function takeSteers(run: Run): Steer[] {
  closeSteers(run);
  return run.steers.splice(0);
}
