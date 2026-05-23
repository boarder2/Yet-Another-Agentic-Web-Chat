import type { Skill } from './types';

const globalStore = globalThis as typeof globalThis & {
  __skillRunStore?: Map<string, Map<string, Skill>>;
};

const store =
  globalStore.__skillRunStore ??
  (globalStore.__skillRunStore = new Map<string, Map<string, Skill>>());

export function storeSkillsForRun(runId: string, skills: Skill[]): void {
  const map = new Map<string, Skill>();
  for (const s of skills) {
    map.set(s.name, s);
  }
  store.set(runId, map);
}

export function getSkillForRun(runId: string, name: string): Skill | undefined {
  return store.get(runId)?.get(name);
}

export function cleanupSkillsForRun(runId: string): void {
  store.delete(runId);
}
