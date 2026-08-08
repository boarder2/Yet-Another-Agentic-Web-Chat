import { describe, it, expect } from 'vitest';
import {
  advance,
  agentSessionId,
  beginChunk,
  buildPaths,
  canTransition,
  createState,
  formatDate,
  mintSlug,
  parseState,
  phaseAfterTriage,
  recordOverride,
  reseedAgent,
  serializeState,
  setStatus,
  type BuildState,
} from './state';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const LATER = new Date('2026-08-06T13:00:00.000Z');

const state = (over: Partial<BuildState> = {}): BuildState => ({
  ...createState('add a retry guard', 'retry-guard', '2026-08-06', NOW),
  ...over,
});

describe('mintSlug', () => {
  it('is deterministic for the same ask', () => {
    expect(mintSlug('Add a retry guard to the runner')).toBe(
      mintSlug('Add a retry guard to the runner'),
    );
  });

  it('drops filler words and caps length', () => {
    expect(mintSlug('Please add a retry guard to the panel coordinator')).toBe(
      'retry-guard-panel-coordinator',
    );
  });

  it('produces filesystem-safe slugs from hostile input', () => {
    const slug = mintSlug('fix //../etc/passwd & "quoting" bugs!!');
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('falls back rather than returning an empty slug', () => {
    expect(mintSlug('!!! ???')).toBe('build');
    expect(mintSlug('the a to for')).toBe('the-a-to-for');
  });
});

describe('formatDate and buildPaths', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 7, 6))).toBe('2026-08-06');
    expect(formatDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('derives all three paths from one date and slug', () => {
    expect(buildPaths('2026-08-06', 'retry-guard')).toEqual({
      plan: '.ai/plans/2026-08-06-retry-guard.md',
      task: '.ai/task/2026-08-06-retry-guard.md',
      state: '.ai/builds/2026-08-06-retry-guard.json',
    });
  });
});

describe('agentSessionId', () => {
  it('names the chunk the session belongs to', () => {
    expect(
      agentSessionId('retry-guard', 'coder', { chunkId: 'chunk-2', generation: 0 }),
    ).toBe('wf-retry-guard-coder-chunk-2');
  });

  it('suffixes reseeded generations within a chunk', () => {
    expect(
      agentSessionId('retry-guard', 'coder', { chunkId: 'chunk-2', generation: 3 }),
    ).toBe('wf-retry-guard-coder-chunk-2-g3');
  });

  it('has a stable id before any chunk has begun', () => {
    expect(
      agentSessionId('retry-guard', 'tester', { chunkId: null, generation: 0 }),
    ).toBe('wf-retry-guard-tester');
  });

  // Two chunks must never share a session, or the reset is cosmetic.
  it('gives every chunk a distinct session', () => {
    const ids = ['chunk-1', 'chunk-2', 'chunk-10'].map((chunkId) =>
      agentSessionId('retry-guard', 'coder', { chunkId, generation: 0 }),
    );
    expect(new Set(ids).size).toBe(3);
  });
});

describe('transitions', () => {
  it('allows only the phases the workflow defines', () => {
    expect(canTransition('triage', 'grill')).toBe(true);
    expect(canTransition('triage', 'plan')).toBe(true);
    expect(canTransition('plan', 'tasks')).toBe(true);
    expect(canTransition('tasks', 'execute')).toBe(true);
    expect(canTransition('execute', 'close')).toBe(true);
  });

  it('refuses to skip the plan and task gates', () => {
    expect(canTransition('triage', 'execute')).toBe(false);
    expect(canTransition('plan', 'execute')).toBe(false);
    expect(canTransition('grill', 'tasks')).toBe(false);
  });

  it('refuses to go backwards or past the end', () => {
    expect(canTransition('tasks', 'plan')).toBe(false);
    expect(canTransition('execute', 'triage')).toBe(false);
    expect(canTransition('close', 'execute')).toBe(false);
  });

  it('routes triage by complexity', () => {
    expect(phaseAfterTriage('complex')).toBe('grill');
    expect(phaseAfterTriage('simple')).toBe('plan');
  });
});

describe('advance', () => {
  it('moves phase and stamps updatedAt without mutating the input', () => {
    const before = state();
    const after = advance(before, 'plan', LATER);

    expect(after.phase).toBe('plan');
    expect(after.updatedAt).toBe(LATER.toISOString());
    expect(before.phase).toBe('triage');
  });

  it('throws on an illegal transition', () => {
    expect(() => advance(state(), 'execute', LATER)).toThrow(
      'Illegal transition: triage -> execute',
    );
  });

  it('refuses to advance a paused or aborted workflow', () => {
    const paused = setStatus(state(), 'paused', LATER);
    expect(() => advance(paused, 'plan', LATER)).toThrow(
      'Cannot advance a paused workflow',
    );

    const aborted = setStatus(state(), 'aborted', LATER);
    expect(() => advance(aborted, 'plan', LATER)).toThrow(
      'Cannot advance a aborted workflow',
    );
  });
});

describe('overrides and reseeding', () => {
  it('appends overrides with a reason and timestamp', () => {
    const after = recordOverride(state(), 'Chunk 3', 'flaky suite', LATER);

    expect(after.overrides).toEqual([
      { chunk: 'Chunk 3', reason: 'flaky suite', at: LATER.toISOString() },
    ]);
  });

  it('bumps only the reseeded agent, and only its generation', () => {
    const started = beginChunk(state(), 'chunk-1', NOW);
    const after = reseedAgent(started, 'coder', LATER);

    expect(after.agents.coder).toEqual({ chunkId: 'chunk-1', generation: 1 });
    expect(after.agents.tester).toEqual({ chunkId: 'chunk-1', generation: 0 });
  });

  // Where each agent lives is read from herdr by name, never stored, so state has
  // no layout to keep in step with the screen.
  it('records no pane layout at all', () => {
    expect(state()).not.toHaveProperty('panes');
    expect(reseedAgent(state(), 'coder', LATER)).not.toHaveProperty('panes');
  });
});

describe('beginChunk', () => {
  it('moves coder and tester onto the new chunk', () => {
    const after = beginChunk(state(), 'chunk-1', LATER);

    expect(after.agents.coder).toEqual({ chunkId: 'chunk-1', generation: 0 });
    expect(after.agents.tester).toEqual({ chunkId: 'chunk-1', generation: 0 });
  });

  it('gives the next chunk different sessions, so nothing carries over', () => {
    const first = beginChunk(state(), 'chunk-1', NOW);
    const second = beginChunk(first, 'chunk-2', LATER);

    expect(
      agentSessionId(second.slug, 'coder', second.agents.coder),
    ).not.toBe(agentSessionId(first.slug, 'coder', first.agents.coder));
  });

  it('drops a within-chunk reseed when the next chunk starts', () => {
    const reseeded = reseedAgent(beginChunk(state(), 'chunk-1', NOW), 'coder', NOW);
    expect(beginChunk(reseeded, 'chunk-2', LATER).agents.coder.generation).toBe(0);
  });

  // Re-running a failed chunk must reattach, not throw away work in progress.
  it('is a no-op for the chunk already in progress', () => {
    const started = beginChunk(state(), 'chunk-1', NOW);
    expect(beginChunk(started, 'chunk-1', LATER)).toBe(started);
  });

  it('leaves a within-chunk reseed alone when the same chunk is re-run', () => {
    const reseeded = reseedAgent(beginChunk(state(), 'chunk-1', NOW), 'coder', NOW);
    expect(beginChunk(reseeded, 'chunk-1', LATER).agents.coder.generation).toBe(1);
  });
});

describe('serialization', () => {
  it('round-trips a state through JSON', () => {
    const before = recordOverride(state(), 'Chunk 1', 'pre-existing', LATER);
    expect(parseState(serializeState(before))).toEqual(before);
  });

  it('rejects malformed, versionless, and unknown-phase state', () => {
    expect(() => parseState('{oops')).toThrow('not valid JSON');
    expect(() => parseState('{"version":99}')).toThrow(
      'Unsupported build state version: 99',
    );
    expect(() => parseState('{"version":1}')).toThrow('missing required fields');
    expect(() =>
      parseState(
        JSON.stringify({
          version: 1,
          slug: 's',
          date: 'd',
          phase: 'shipping',
          status: 'active',
        }),
      ),
    ).toThrow('Unknown phase: shipping');
  });
});
