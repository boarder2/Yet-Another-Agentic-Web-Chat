import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildArtifactPaths,
  listBuilds,
  removeBuildArtifacts,
} from './store.ts';
import {
  createState,
  serializeState,
} from './state.ts';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const roots: string[] = [];

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'yaawc-build-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('buildArtifactPaths', () => {
  it('includes state, documents, and every agent scratch file', () => {
    const state = createState('add a retry guard', 'retry-guard', '2026-08-06', NOW);

    expect(buildArtifactPaths(state)).toEqual([
      '.ai/builds/2026-08-06-retry-guard.json',
      '.ai/plans/2026-08-06-retry-guard.candidate.md',
      '.ai/task/2026-08-06-retry-guard.candidate.md',
      '.ai/builds/2026-08-06-retry-guard-coder.system.md',
      '.ai/builds/2026-08-06-retry-guard-coder.result.json',
      '.ai/builds/2026-08-06-retry-guard-tester.system.md',
      '.ai/builds/2026-08-06-retry-guard-tester.result.json',
      '.ai/builds/2026-08-06-retry-guard-reviewer.system.md',
      '.ai/builds/2026-08-06-retry-guard-reviewer.result.json',
    ]);
  });
});

describe('unsupported workflows', () => {
  it('lists version-1 state for inspection and deletion without making it executable', () => {
    const root = tempProject();
    const path = join(root, '.ai', 'builds', '2026-08-06-old.json');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      version: 1,
      slug: 'old',
      date: '2026-08-06',
      ask: 'old workflow',
      phase: 'execute',
      status: 'active',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }));

    expect(listBuilds(root)).toMatchObject([
      { supported: false, state: { version: 1, slug: 'old' } },
    ]);
    expect(buildArtifactPaths({
      version: 1,
      slug: 'old',
      date: '2026-08-06',
      planPath: '../../outside',
      taskPath: '/tmp/outside',
    })).not.toEqual(expect.arrayContaining(['../../outside', '/tmp/outside']));
  });
});

describe('removeBuildArtifacts', () => {
  it('removes all owned files and empty artifact directories', () => {
    const root = tempProject();
    const state = createState('add a retry guard', 'retry-guard', '2026-08-06', NOW);

    for (const relative of buildArtifactPaths(state)) {
      const path = join(root, relative);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, relative.endsWith('.json') ? serializeState(state) : 'scratch');
    }

    removeBuildArtifacts(root, state);

    for (const relative of buildArtifactPaths(state)) {
      expect(existsSync(join(root, relative)), relative).toBe(false);
    }
    expect(existsSync(join(root, '.ai'))).toBe(false);
  });

  it('keeps another build and unrelated scratch files', () => {
    const root = tempProject();
    const state = createState('add a retry guard', 'retry-guard', '2026-08-06', NOW);
    const keepState = join(root, '.ai', 'builds', 'keep.json');
    const keepPlan = join(root, '.ai', 'plans', 'keep.md');
    const keepScratch = join(root, '.ai', 'builds', '2026-08-06-retry-guard-other.txt');

    for (const path of [keepState, keepPlan, keepScratch]) {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'keep');
    }
    const statePath = join(root, buildArtifactPaths(state)[0]);
    writeFileSync(statePath, serializeState(state));

    removeBuildArtifacts(root, state);

    expect(readFileSync(keepState, 'utf8')).toBe('keep');
    expect(readFileSync(keepPlan, 'utf8')).toBe('keep');
    expect(readFileSync(keepScratch, 'utf8')).toBe('keep');
    expect(existsSync(statePath)).toBe(false);
  });
});
