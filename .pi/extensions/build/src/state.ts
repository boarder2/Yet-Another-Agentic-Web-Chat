import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PHASES = [
  'triage',
  'grill',
  'plan',
  'tasks',
  'execute',
  'close',
] as const;

export type Phase = (typeof PHASES)[number];
export type Complexity = 'simple' | 'complex';
export type Status = 'active' | 'paused' | 'aborted' | 'done';
export type AgentName = 'coder' | 'tester';

const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  triage: ['grill', 'plan'],
  grill: ['plan'],
  plan: ['tasks'],
  tasks: ['execute'],
  execute: ['close'],
  close: [],
};

export interface AgentSession {
  sessionId: string;
  generation: number;
  tokensUsed: number;
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

// Generation 0 keeps the bare id so an unreseeded agent is addressable as
// `pi --session wf-<slug>-coder`, which is what /build:attach prints.
export function agentSessionId(
  slug: string,
  agent: AgentName,
  generation = 0,
): string {
  const base = `wf-${slug}-${agent}`;
  return generation === 0 ? base : `${base}-g${generation}`;
}

export function createState(
  ask: string,
  slug: string,
  date: string,
  now: Date,
): BuildState {
  const timestamp = now.toISOString();
  const agent = (name: AgentName): AgentSession => ({
    sessionId: agentSessionId(slug, name),
    generation: 0,
    tokensUsed: 0,
  });

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
    agents: { coder: agent('coder'), tester: agent('tester') },
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

export function reseedAgent(
  state: BuildState,
  agent: AgentName,
  now: Date,
): BuildState {
  const generation = state.agents[agent].generation + 1;
  return {
    ...state,
    agents: {
      ...state.agents,
      [agent]: {
        sessionId: agentSessionId(state.slug, agent, generation),
        generation,
        tokensUsed: 0,
      },
    },
    updatedAt: now.toISOString(),
  };
}

// Session ids embed the slug, so a rename has to re-derive them or the agents
// would keep talking to sessions named after the old slug.
export function renameSlug(
  state: BuildState,
  slug: string,
  now: Date,
): BuildState {
  const agents = { ...state.agents };
  for (const name of Object.keys(agents) as AgentName[]) {
    agents[name] = {
      ...agents[name],
      sessionId: agentSessionId(slug, name, agents[name].generation),
    };
  }
  return { ...state, slug, agents, updatedAt: now.toISOString() };
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
