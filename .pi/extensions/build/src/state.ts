import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PHASES = ['triage', 'grill', 'plan', 'execute', 'review', 'close'] as const;

export type Phase = (typeof PHASES)[number];
export type Complexity = 'simple' | 'complex';
export type Status = 'active' | 'paused' | 'aborted' | 'done';
export type AgentName = 'coder' | 'tester';
export type ReplanRole = AgentName | 'reviewer' | 'human' | 'integrity';

const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  triage: ['grill', 'plan'],
  grill: ['plan'],
  plan: ['execute'],
  execute: ['review'],
  review: ['close'],
  close: [],
};

export interface AgentSession {
  chunkId: string | null;
  generation: number;
}

export interface ChunkOverride {
  revision: number;
  chunk: string;
  reason: string;
  at: string;
}

export interface ReplanRequest {
  role: ReplanRole;
  rationale: string;
  at: string;
  supersededRevision: number;
  completedChunks: string[];
  overrides: Array<{ chunk: string; reason: string }>;
}

export interface RevisionRecord {
  revision: number;
  planPath: string;
  taskPath: string;
  planHash: string;
  taskHash: string;
  designSummary: string;
  approvedAt: string;
  trigger: ReplanRequest | null;
}

export interface BuildState {
  version: 2;
  slug: string;
  date: string;
  ask: string;
  complexity: Complexity | null;
  phase: Phase;
  status: Status;
  revision: number;
  planPath: string | null;
  taskPath: string | null;
  planHash: string | null;
  taskHash: string | null;
  revisions: RevisionRecord[];
  pendingReplan: ReplanRequest | null;
  agents: Record<AgentName, AgentSession>;
  rounds: Record<string, number>;
  overrides: ChunkOverride[];
  lastAttachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildPaths {
  state: string;
  planCandidate: string;
  taskCandidate: string;
}

export interface RevisionPaths {
  plan: string;
  task: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'for', 'of', 'in', 'on', 'with', 'that',
  'this', 'it', 'is', 'be', 'can', 'we', 'i', 'please', 'add', 'make',
]);

const MAX_SLUG_WORDS = 4;
const MAX_SLUG_LENGTH = 40;
const freshAgent = (): AgentSession => ({ chunkId: null, generation: 0 });

export function mintSlug(ask: string): string {
  const words = ask
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !STOPWORDS.has(word));
  const chosen = (meaningful.length ? meaningful : words).slice(0, MAX_SLUG_WORDS);
  const slug = chosen.join('-').slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
  return slug || 'build';
}

export function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildName(date: string, slug: string): string {
  return `${date}-${slug}`;
}

export function buildPaths(date: string, slug: string): BuildPaths {
  const name = buildName(date, slug);
  return {
    state: `.ai/builds/${name}.json`,
    planCandidate: `.ai/plans/${name}.candidate.md`,
    taskCandidate: `.ai/task/${name}.candidate.md`,
  };
}

export function revisionPaths(
  date: string,
  slug: string,
  revision: number,
): RevisionPaths {
  const name = `${buildName(date, slug)}-r${revision}`;
  return {
    plan: `.ai/plans/${name}.md`,
    task: `.ai/task/${name}.md`,
  };
}

export function agentSessionId(
  slug: string,
  revision: number,
  agent: AgentName,
  session: AgentSession,
): string {
  const chunk = session.chunkId ? `-${session.chunkId}` : '';
  const generation = session.generation ? `-g${session.generation}` : '';
  return `wf-${slug}-r${revision}-${agent}${chunk}${generation}`;
}

export function createState(
  ask: string,
  slug: string,
  date: string,
  now: Date,
): BuildState {
  const timestamp = now.toISOString();
  return {
    version: 2,
    slug,
    date,
    ask,
    complexity: null,
    phase: 'triage',
    status: 'active',
    revision: 0,
    planPath: null,
    taskPath: null,
    planHash: null,
    taskHash: null,
    revisions: [],
    pendingReplan: null,
    agents: { coder: freshAgent(), tester: freshAgent() },
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

export function approveRevision(
  state: BuildState,
  revision: Omit<RevisionRecord, 'revision' | 'approvedAt' | 'trigger'>,
  now: Date,
): BuildState {
  if (state.phase !== 'plan' || state.status !== 'active') {
    throw new Error('A revision can only be approved during active planning');
  }
  const record: RevisionRecord = {
    ...revision,
    revision: state.revision + 1,
    approvedAt: now.toISOString(),
    trigger: state.pendingReplan,
  };
  return {
    ...state,
    phase: 'execute',
    revision: record.revision,
    planPath: record.planPath,
    taskPath: record.taskPath,
    planHash: record.planHash,
    taskHash: record.taskHash,
    revisions: [...state.revisions, record],
    pendingReplan: null,
    agents: { coder: freshAgent(), tester: freshAgent() },
    rounds: {},
    updatedAt: now.toISOString(),
  };
}

export function returnToPlanning(
  state: BuildState,
  role: ReplanRole,
  rationale: string,
  now: Date,
): BuildState {
  if (!['execute', 'review', 'close'].includes(state.phase)) {
    throw new Error(`Cannot re-plan from the ${state.phase} phase`);
  }
  const request: ReplanRequest = {
    role,
    rationale: rationale.trim(),
    at: now.toISOString(),
    supersededRevision: state.revision,
    completedChunks: Object.keys(state.rounds),
    overrides: state.overrides
      .filter((override) => override.revision === state.revision)
      .map(({ chunk, reason }) => ({ chunk, reason })),
  };
  return {
    ...state,
    phase: 'plan',
    pendingReplan: request,
    agents: { coder: freshAgent(), tester: freshAgent() },
    rounds: {},
    updatedAt: now.toISOString(),
  };
}

export function setStatus(state: BuildState, status: Status, now: Date): BuildState {
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
    overrides: [
      ...state.overrides,
      { revision: state.revision, chunk, reason, at },
    ],
    updatedAt: at,
  };
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function parseState(text: string): BuildState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Build state is not valid JSON');
  }

  if (!isRecord(raw)) throw new Error('Build state is missing required fields');
  if (raw.version !== 2) {
    throw new Error(`Unsupported build state version: ${raw.version}`);
  }
  if (
    typeof raw.slug !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]*$/i.test(raw.slug) ||
    typeof raw.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) ||
    typeof raw.ask !== 'string' ||
    !PHASES.includes(raw.phase as Phase) ||
    !['active', 'paused', 'aborted', 'done'].includes(String(raw.status)) ||
    !Number.isInteger(raw.revision) ||
    Number(raw.revision) < 0 ||
    !Array.isArray(raw.revisions) ||
    !Array.isArray(raw.overrides) ||
    !isRecord(raw.agents) ||
    !isRecord(raw.rounds) ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.updatedAt !== 'string'
  ) {
    throw new Error('Build state has invalid version-2 fields');
  }

  const state = raw as unknown as BuildState;
  const validAgent = (agent: unknown) =>
    isRecord(agent) &&
    (agent.chunkId === null || typeof agent.chunkId === 'string') &&
    Number.isInteger(agent.generation) &&
    Number(agent.generation) >= 0;
  if (!validAgent(state.agents.coder) || !validAgent(state.agents.tester)) {
    throw new Error('Build state has invalid agent sessions');
  }

  const revisionsValid = state.revisions.every((revision, index) => {
    if (!isRecord(revision) || revision.revision !== index + 1) return false;
    const expected = revisionPaths(state.date, state.slug, revision.revision as number);
    return (
      revision.planPath === expected.plan &&
      revision.taskPath === expected.task &&
      typeof revision.planHash === 'string' &&
      typeof revision.taskHash === 'string' &&
      typeof revision.designSummary === 'string' &&
      typeof revision.approvedAt === 'string'
    );
  });
  if (!revisionsValid || state.revision !== state.revisions.length) {
    throw new Error('Build state has invalid revision history');
  }

  if (state.revision === 0) {
    if (
      state.planPath !== null ||
      state.taskPath !== null ||
      state.planHash !== null ||
      state.taskHash !== null
    ) {
      throw new Error('Build state has unapproved document metadata');
    }
  } else {
    const current = revisionPaths(state.date, state.slug, state.revision);
    if (
      state.planPath !== current.plan ||
      state.taskPath !== current.task ||
      typeof state.planHash !== 'string' ||
      typeof state.taskHash !== 'string'
    ) {
      throw new Error('Build state has invalid current revision metadata');
    }
  }

  return state;
}

export function readStateFile(path: string): BuildState {
  return parseState(readFileSync(path, 'utf-8'));
}

export function writeStateFile(path: string, state: BuildState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeState(state), 'utf-8');
}
