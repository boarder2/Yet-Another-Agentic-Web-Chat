import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPaths,
  readStateFile,
  writeStateFile,
  type BuildState,
} from './state.ts';

const BUILDS_DIR = '.ai/builds';

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

export function findBuild(cwd: string, slug: string): StoredBuild | null {
  return listBuilds(cwd).find((build) => build.state.slug === slug) ?? null;
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
