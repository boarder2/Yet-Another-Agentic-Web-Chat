import type { Skill } from './types';

export type RunContext = {
  chatId: string;
  parentMessageId: string;
  skills: Map<string, Skill>;
};

const globalStore = globalThis as typeof globalThis & {
  __skillRunStore?: Map<string, RunContext>;
};

const store =
  globalStore.__skillRunStore ??
  (globalStore.__skillRunStore = new Map<string, RunContext>());

export function setRunContext(
  runId: string,
  ctx: { chatId: string; parentMessageId: string; skills?: Skill[] },
): void {
  const existing = store.get(runId);
  const map = existing?.skills ?? new Map<string, Skill>();
  if (ctx.skills) {
    map.clear();
    for (const s of ctx.skills) map.set(s.name, s);
  }
  store.set(runId, {
    chatId: ctx.chatId,
    parentMessageId: ctx.parentMessageId,
    skills: map,
  });
}

export function getRunContext(runId: string): RunContext | undefined {
  return store.get(runId);
}

export function storeSkillsForRun(runId: string, skills: Skill[]): void {
  const existing = store.get(runId);
  const map = new Map<string, Skill>();
  for (const s of skills) map.set(s.name, s);
  store.set(runId, {
    chatId: existing?.chatId ?? '',
    parentMessageId: existing?.parentMessageId ?? '',
    skills: map,
  });
}

export function getSkillForRun(runId: string, name: string): Skill | undefined {
  return store.get(runId)?.skills.get(name);
}

export function cleanupSkillsForRun(runId: string): void {
  store.delete(runId);
  // Best-effort clear of any context_grew running totals for this run.
  // Imported lazily to avoid a circular import (persistToolContext -> runStore).
  import('@/lib/utils/persistToolContext')
    .then((m) => m.resetContextGrewTotal(runId))
    .catch(() => {});
}
