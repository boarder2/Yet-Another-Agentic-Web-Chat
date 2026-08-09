import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROLES } from './models.ts';
import {
  buildPaths,
  readStateFile,
  writeStateFile,
  type BuildState,
} from './state.ts';

const BUILDS_DIR = '.ai/builds';
const SAFE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

export interface StoredBuild {
  state: BuildState;
  file: string;
}

export function statePath(cwd: string, date: string, slug: string): string {
  return join(cwd, buildPaths(date, slug).state);
}

export function saveBuild(cwd: string, state: BuildState): void {
  writeStateFile(statePath(cwd, state.date, state.slug), state);
}

export function listBuilds(cwd: string): StoredBuild[] {
  const dir = join(cwd, BUILDS_DIR);
  if (!existsSync(dir)) return [];

  const builds: StoredBuild[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    try {
      builds.push({ state: readStateFile(file), file });
    } catch {
      // A corrupt or half-written state file must not hide the healthy ones.
    }
  }
  return builds.sort((a, b) =>
    b.state.createdAt.localeCompare(a.state.createdAt),
  );
}

export function findBuild(
  cwd: string,
  slug: string,
  date?: string,
): StoredBuild | null {
  return (
    listBuilds(cwd).find(
      (build) =>
        build.state.slug === slug && (date === undefined || build.state.date === date),
    ) ?? null
  );
}

/** Every project file owned by one workflow, including agent scratch. */
export function buildArtifactPaths(state: Pick<BuildState, 'date' | 'slug'>): string[] {
  const paths = buildPaths(state.date, state.slug);
  const scratch = AGENT_ROLES.flatMap((role) => [
    `.ai/builds/${state.date}-${state.slug}-${role}.system.md`,
    `.ai/builds/${state.date}-${state.slug}-${role}.result.json`,
  ]);

  return [paths.state, paths.plan, paths.task, ...scratch];
}

/** Remove a workflow's files without touching the rest of `.ai`. */
export function removeBuildArtifacts(
  cwd: string,
  state: Pick<BuildState, 'date' | 'slug'>,
  stateFile?: string,
): void {
  if (!SAFE_DATE.test(state.date) || !SAFE_SLUG.test(state.slug)) {
    throw new Error(`Refusing to remove workflow with unsafe date or slug: ${state.date}/${state.slug}`);
  }

  for (const relative of buildArtifactPaths(state)) {
    rmSync(join(cwd, relative), { force: true });
  }
  if (stateFile) rmSync(stateFile, { force: true });

  // Empty artifact directories are traces too, but never remove a directory that
  // still belongs to another build or contains an unrelated file.
  for (const relative of ['.ai/builds', '.ai/plans', '.ai/task', '.ai']) {
    try {
      rmdirSync(join(cwd, relative));
    } catch {
      // Missing or non-empty directories are both expected.
    }
  }
}

// Renaming rewrites under the new name and drops the old file, so `/build:list`
// never shows the same workflow twice.
export function renameBuild(
  cwd: string,
  previousSlug: string,
  state: BuildState,
): void {
  saveBuild(cwd, state);
  const stale = statePath(cwd, state.date, previousSlug);
  if (previousSlug !== state.slug && existsSync(stale)) {
    rmSync(stale);
  }
}

// A slug is a filename, so it must be unique per date even when two asks reduce
// to the same words.
export function uniqueSlug(cwd: string, date: string, slug: string): string {
  mkdirSync(join(cwd, BUILDS_DIR), { recursive: true });

  let candidate = slug;
  for (let n = 2; existsSync(statePath(cwd, date, candidate)); n++) {
    candidate = `${slug}-${n}`;
  }
  return candidate;
}
