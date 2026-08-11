import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PHASES = ['triage', 'grill', 'plan', 'execute', 'review', 'close'] as const;

export type Phase = (typeof PHASES)[number];
export type Complexity = 'simple' | 'complex';
export type Status = 'active' | 'paused' | 'aborted' | 'done';
export type AgentName = 'coder' | 'tester';

const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  triage: ['grill', 'plan'],
  grill: ['plan'],
  plan: ['execute'],
  execute: ['review'],
  review: ['close'],
  close: [],
};

/**
 * Coder and tester get a new session per chunk, so nothing rots across chunks. The
 * session id is derived rather than stored: a stored id could disagree with the
 * chunk it was minted for, and then a resumed workflow would talk to the wrong
 * session while believing it had a fresh one.
 */
export interface AgentSession {
  /** Chunk this session belongs to; null before the first chunk begins. */
  chunkId: string | null;
  /** Bumped when an agent outgrows its context budget *within* a chunk. */
  generation: number;
}

export interface ChunkOverride {
  chunk: string;
  reason: string;
  at: string;
}

export interface BuildState {
  version: 1;
  slug: string;
  date: string;
  ask: string;
  complexity: Complexity | null;
  phase: Phase;
  status: Status;
  planPath: string | null;
  taskPath: string | null;
  taskHash?: string | null;
  agents: Record<AgentName, AgentSession>;
  rounds: Record<string, number>;
  overrides: ChunkOverride[];
  lastAttachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildPaths {
  plan: string;
  task: string;
  state: string;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'that',
  'this',
  'it',
  'is',
  'be',
  'can',
  'we',
  'i',
  'please',
  'add',
  'make',
]);

const MAX_SLUG_WORDS = 4;
const MAX_SLUG_LENGTH = 40;

export function mintSlug(ask: string): string {
  const words = ask
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);

  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  const chosen = (meaningful.length ? meaningful : words).slice(
    0,
    MAX_SLUG_WORDS,
  );

  const slug = chosen.join('-').slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
  return slug || 'build';
}

export function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildPaths(date: string, slug: string): BuildPaths {
  const name = `${date}-${slug}`;
  return {
    plan: `.ai/plans/${name}.md`,
    task: `.ai/task/${name}.md`,
    state: `.ai/builds/${name}.json`,
  };
}

export function agentSessionId(
  slug: string,
  agent: AgentName,
  session: AgentSession,
): string {
  const chunk = session.chunkId ? `-${session.chunkId}` : '';
  const generation = session.generation ? `-g${session.generation}` : '';
  return `wf-${slug}-${agent}${chunk}${generation}`;
}

export function createState(
  ask: string,
  slug: string,
  date: string,
  now: Date,
): BuildState {
  const timestamp = now.toISOString();
  const agent = (): AgentSession => ({ chunkId: null, generation: 0 });

  return {
    version: 1,
    slug,
    date,
    ask,
    complexity: null,
    phase: 'triage',
    status: 'active',
    planPath: null,
    taskPath: null,
    taskHash: null,
    agents: { coder: agent(), tester: agent() },
    rounds: {},
    overrides: [],
    lastAttachedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function phaseAfterTriage(complexity: Complexity): Phase {
  return complexity === 'complex' ? 'grill' : 'plan';
}

export function advance(state: BuildState, to: Phase, now: Date): BuildState {
  if (state.status !== 'active') {
    throw new Error(`Cannot advance a ${state.status} workflow`);
  }
  if (!canTransition(state.phase, to)) {
    throw new Error(`Illegal transition: ${state.phase} -> ${to}`);
  }
  return { ...state, phase: to, updatedAt: now.toISOString() };
}

export function setStatus(
  state: BuildState,
  status: Status,
  now: Date,
): BuildState {
  return { ...state, status, updatedAt: now.toISOString() };
}

export function recordOverride(
  state: BuildState,
  chunk: string,
  reason: string,
  now: Date,
): BuildState {
  const at = now.toISOString();
  return {
    ...state,
    overrides: [...state.overrides, { chunk, reason, at }],
    updatedAt: at,
  };
}

/**
 * Puts coder and tester on a new session for a new chunk. Context earned on an
 * earlier chunk is a liability on the next one: the plan and the chunk are restated
 * in every brief, so a fresh agent loses continuity, not the brief.
 *
 * Idempotent per chunk, so re-running the same chunk after a failure reattaches to
 * the sessions already working on it rather than throwing their work away.
 */
export function beginChunk(
  state: BuildState,
  chunkId: string,
  now: Date,
): BuildState {
  if (state.agents.coder.chunkId === chunkId) return state;

  const fresh: AgentSession = { chunkId, generation: 0 };
  return {
    ...state,
    agents: { coder: { ...fresh }, tester: { ...fresh } },
    updatedAt: now.toISOString(),
  };
}

/**
 * The final review is a distinct job, so its repair crew must not inherit the
 * last chunk's narrow brief or its accumulated context.
 */
export function beginReview(state: BuildState, now: Date): BuildState {
  const generation =
    state.agents.coder.chunkId === 'review'
      ? Math.max(state.agents.coder.generation, state.agents.tester.generation) + 1
      : 0;
  const fresh: AgentSession = { chunkId: 'review', generation };
  return {
    ...state,
    agents: { coder: { ...fresh }, tester: { ...fresh } },
    updatedAt: now.toISOString(),
  };
}

export function reseedAgent(
  state: BuildState,
  agent: AgentName,
  now: Date,
): BuildState {
  return {
    ...state,
    agents: {
      ...state.agents,
      [agent]: {
        ...state.agents[agent],
        generation: state.agents[agent].generation + 1,
      },
    },
    updatedAt: now.toISOString(),
  };
}

// Session ids derive from the slug, so a rename re-points the agents by itself.
export function renameSlug(
  state: BuildState,
  slug: string,
  now: Date,
): BuildState {
  return { ...state, slug, updatedAt: now.toISOString() };
}

export function serializeState(state: BuildState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function parseState(text: string): BuildState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Build state is not valid JSON');
  }

  const state = raw as Partial<BuildState>;
  if (state?.version !== 1) {
    throw new Error(`Unsupported build state version: ${state?.version}`);
  }
  if (!state.slug || !state.date || !state.phase || !state.status) {
    throw new Error('Build state is missing required fields');
  }
  // Chunking was once a phase of its own; a workflow saved mid-chunking re-enters
  // planning and submits the plan and the task list together.
  if ((state.phase as string) === 'tasks') state.phase = 'plan';
  if (!PHASES.includes(state.phase)) {
    throw new Error(`Unknown phase: ${state.phase}`);
  }
  return state as BuildState;
}

export function readStateFile(path: string): BuildState {
  return parseState(readFileSync(path, 'utf-8'));
}

export function writeStateFile(path: string, state: BuildState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeState(state), 'utf-8');
}
