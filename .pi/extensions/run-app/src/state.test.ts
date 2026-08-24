import { chmodSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadState, saveState } from './state.ts';
import {
  parseAppState,
  staleState,
  stoppedFrom,
  stoppedState,
} from './types.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('state persistence', () => {
  it('writes atomically with user-only permissions and reloads external state', () => {
    const root = mkdtempSync(join(tmpdir(), 'yaawc-run-app-state-'));
    roots.push(root);
    const path = join(root, '.state.json');
    const state = {
      ...stoppedState(root, '/tmp/yaawc-dev.log'),
      lifecycle: 'running' as const,
      ownership: 'external' as const,
      port: 5005,
      url: 'http://localhost:5005',
      health: 'healthy' as const,
    };

    saveState(path, state);
    chmodSync(path, 0o644);
    expect(loadState(path)).toEqual(state);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('rejects incomplete active owned state and malformed PIDs', () => {
    expect(
      parseAppState({
        ...stoppedState('/tmp/project', '/tmp/log'),
        lifecycle: 'running',
        ownership: 'owned',
      }),
    ).toBeNull();
    expect(
      parseAppState({
        ...stoppedState('/tmp/project', '/tmp/log'),
        pid: 'reused',
      }),
    ).toBeNull();
  });
});

describe('staleness transitions', () => {
  it('marks a run stale without deleting its log or tail metadata', () => {
    const state = {
      ...stoppedState('/tmp/project', '/tmp/log'),
      lifecycle: 'running' as const,
      ownership: 'owned' as const,
      pid: 41,
      pgid: 41,
      ownershipToken: 'token',
      controllerPid: 7,
      port: 5005,
      url: 'http://localhost:5005',
      tailPaneId: 'w1:p9',
    };
    const stale = staleState(state, 'child exited');
    expect(stale.lifecycle).toBe('stale');
    expect(stale.health).toBe('unhealthy');
    expect(stale.tailPaneId).toBe('w1:p9');
    expect(stale.staleReason).toBe('child exited');
  });

  it('turns a stopped run into non-owned metadata while preserving diagnostics', () => {
    const state = {
      ...stoppedState('/tmp/project', '/tmp/log'),
      lifecycle: 'stale' as const,
      ownership: 'owned' as const,
      pid: 41,
      pgid: 41,
      ownershipToken: 'token',
      port: 5005,
      url: 'http://localhost:5005',
      dataDir: '/tmp/data',
    };
    const stopped = stoppedFrom(state, 'stopped');
    expect(stopped).toMatchObject({
      lifecycle: 'stopped',
      ownership: 'none',
      pid: null,
      dataDir: '/tmp/data',
    });
  });
});
