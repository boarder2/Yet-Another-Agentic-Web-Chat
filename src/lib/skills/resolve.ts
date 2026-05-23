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
    }));

  // Build merged set: user beats system, workspace beats global
  const merged = new Map<string, Skill>();

  // Start with system skills
  for (const s of systemSkills) {
    merged.set(s.name, s);
  }

  // Global user skills override system
  for (const s of enabledUserSkills.filter((s) => !s.workspaceId)) {
    if (merged.has(s.name)) {
      console.warn(
        `[skills] User skill "${s.name}" shadows system skill with same name`,
      );
    }
    merged.set(s.name, s);
  }

  // Workspace user skills override global/system
  if (workspaceId) {
    for (const s of enabledUserSkills.filter((s) => s.workspaceId)) {
      if (merged.has(s.name)) {
        console.warn(
          `[skills] Workspace skill "${s.name}" (workspace=${workspaceId}) shadows existing skill`,
        );
      }
      merged.set(s.name, s);
    }
  }

  return Array.from(merged.values());
}

export function getByName(skills: Skill[], name: string): Skill | undefined {
  return skills.find((s) => s.name === name);
}
