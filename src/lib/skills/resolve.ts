import { getSystemSkills } from './systemRegistry';
import type { Skill } from './types';
import db from '@/lib/db';
import { skills as skillsTable } from '@/lib/db/schema';
import { eq, isNull, or } from 'drizzle-orm';

export async function resolveSkillsForChat(
  workspaceId?: string | null,
): Promise<Skill[]> {
  const systemSkills = getSystemSkills();

  // Fetch enabled user skills for this scope
  const userRows = workspaceId
    ? db
        .select()
        .from(skillsTable)
        .where(
          or(
            isNull(skillsTable.workspaceId),
            eq(skillsTable.workspaceId, workspaceId),
          ),
        )
        .all()
    : db
        .select()
        .from(skillsTable)
        .where(isNull(skillsTable.workspaceId))
        .all();

  const enabledUserSkills: Skill[] = userRows
    .filter((r) => r.enabled)
    .map((r) => ({
      source: 'user' as const,
      id: r.id,
      name: r.name,
      description: r.description,
      content: r.content,
      workspaceId: r.workspaceId,
      disableModelInvocation: r.disableModelInvocation,
    }));

  // Build merged set: workspace beats global, but neither may override a
  // system skill — system names are reserved so a stray DB row (created
  // before the create-time guards, or by an older client) can never replace
  // trusted built-in skills like chart-creation / code-execution.
  const systemNames = new Set(systemSkills.map((s) => s.name));
  const merged = new Map<string, Skill>();

  // Start with system skills
  for (const s of systemSkills) {
    merged.set(s.name, s);
  }

  // Global user skills (skip any that collide with a system skill)
  for (const s of enabledUserSkills.filter((s) => !s.workspaceId)) {
    if (systemNames.has(s.name)) {
      console.warn(
        `[skills] User skill "${s.name}" ignored: name is reserved by a system skill`,
      );
      continue;
    }
    merged.set(s.name, s);
  }

  // Workspace user skills override global, but still never system
  if (workspaceId) {
    for (const s of enabledUserSkills.filter((s) => s.workspaceId)) {
      if (systemNames.has(s.name)) {
        console.warn(
          `[skills] Workspace skill "${s.name}" (workspace=${workspaceId}) ignored: name is reserved by a system skill`,
        );
        continue;
      }
      merged.set(s.name, s);
    }
  }

  return Array.from(merged.values());
}

export function getByName(skills: Skill[], name: string): Skill | undefined {
  return skills.find((s) => s.name === name);
}
