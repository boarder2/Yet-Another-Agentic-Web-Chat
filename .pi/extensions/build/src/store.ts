import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROLES } from './models.ts';
import {
  buildPaths,
  readStateFile,
  revisionPaths,
  writeStateFile,
  type BuildState,
} from './state.ts';

const BUILDS_DIR = '.ai/builds';
const SAFE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

export interface UnsupportedBuildState {
  version: number;
  slug: string;
  date: string;
  ask: string;
  phase: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastAttachedAt: string | null;
  planPath?: string | null;
  taskPath?: string | null;
}

export type StoredBuild =
  | { supported: true; state: BuildState; file: string }
  | { supported: false; state: UnsupportedBuildState; file: string };

type ArtifactState = Pick<UnsupportedBuildState, 'version' | 'date' | 'slug'> & {
  planPath?: string | null;
  taskPath?: string | null;
  revisions?: BuildState['revisions'];
};

export function statePath(cwd: string, date: string, slug: string): string {
  return join(cwd, buildPaths(date, slug).state);
}

export function saveBuild(cwd: string, state: BuildState): void {
  writeStateFile(statePath(cwd, state.date, state.slug), state);
}

function unsupportedState(text: string): UnsupportedBuildState | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof raw.version !== 'number' ||
      typeof raw.slug !== 'string' ||
      typeof raw.date !== 'string'
    ) return null;
    return {
      version: raw.version,
      slug: raw.slug,
      date: raw.date,
      ask: typeof raw.ask === 'string' ? raw.ask : '',
      phase: typeof raw.phase === 'string' ? raw.phase : 'unknown',
      status: typeof raw.status === 'string' ? raw.status : 'unsupported',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      lastAttachedAt: typeof raw.lastAttachedAt === 'string' ? raw.lastAttachedAt : null,
      planPath: typeof raw.planPath === 'string' ? raw.planPath : null,
      taskPath: typeof raw.taskPath === 'string' ? raw.taskPath : null,
    };
  } catch {
    return null;
  }
}

export function listBuilds(cwd: string): StoredBuild[] {
  const dir = join(cwd, BUILDS_DIR);
  if (!existsSync(dir)) return [];

  const builds: StoredBuild[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    try {
      builds.push({ supported: true, state: readStateFile(file), file });
    } catch {
      const state = unsupportedState(readFileSync(file, 'utf-8'));
      if (state) builds.push({ supported: false, state, file });
    }
  }
  return builds.sort((left, right) =>
    right.state.createdAt.localeCompare(left.state.createdAt),
  );
}

export function findBuild(
  cwd: string,
  slug: string,
  date?: string,
): StoredBuild | null {
  return listBuilds(cwd).find(
    (build) =>
      build.state.slug === slug &&
      (date === undefined || build.state.date === date),
  ) ?? null;
}

export function buildArtifactPaths(state: ArtifactState): string[] {
  const paths = buildPaths(state.date, state.slug);
  const approved = state.version === 2
    ? (state.revisions ?? []).flatMap((revision) => {
        const paths = revisionPaths(state.date, state.slug, revision.revision);
        return [paths.plan, paths.task];
      })
    : [];
  const legacyName = `${state.date}-${state.slug}.md`;
  const legacy = state.version === 2
    ? []
    : [`.ai/plans/${legacyName}`, `.ai/task/${legacyName}`];
  const documents = [
    paths.planCandidate,
    paths.taskCandidate,
    ...approved,
    ...legacy,
  ];
  const scratch = AGENT_ROLES.flatMap((role) => [
    `.ai/builds/${state.date}-${state.slug}-${role}.system.md`,
    `.ai/builds/${state.date}-${state.slug}-${role}.result.json`,
  ]);
  return [...new Set([paths.state, ...documents, ...scratch])];
}

export function removeBuildArtifacts(
  cwd: string,
  state: ArtifactState,
  stateFile?: string,
): void {
  if (!SAFE_DATE.test(state.date) || !SAFE_SLUG.test(state.slug)) {
    throw new Error(
      `Refusing to remove workflow with unsafe date or slug: ${state.date}/${state.slug}`,
    );
  }

  for (const relative of buildArtifactPaths(state)) {
    rmSync(join(cwd, relative), { force: true });
  }
  if (stateFile) rmSync(stateFile, { force: true });

  for (const relative of ['.ai/builds', '.ai/plans', '.ai/task', '.ai']) {
    try {
      rmdirSync(join(cwd, relative));
    } catch {
      // Missing or non-empty directories are expected.
    }
  }
}

export function renameBuild(
  cwd: string,
  previousSlug: string,
  state: BuildState,
): void {
  saveBuild(cwd, state);
  const stale = statePath(cwd, state.date, previousSlug);
  if (previousSlug !== state.slug && existsSync(stale)) rmSync(stale);
}

export function uniqueSlug(cwd: string, date: string, slug: string): string {
  mkdirSync(join(cwd, BUILDS_DIR), { recursive: true });
  let candidate = slug;
  for (let number = 2; existsSync(statePath(cwd, date, candidate)); number++) {
    candidate = `${slug}-${number}`;
  }
  return candidate;
}
