import db from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { eq, isNull, and, or } from 'drizzle-orm';

export type UserSkillCreate = {
  name: string;
  description: string;
  content: string;
  workspaceId?: string | null;
  disableModelInvocation?: boolean;
};

export type UserSkillUpdate = Partial<UserSkillCreate> & { enabled?: boolean };

export async function listUserSkills(workspaceId?: string | null) {
  if (workspaceId) {
    return db
      .select()
      .from(skills)
      .where(
        or(isNull(skills.workspaceId), eq(skills.workspaceId, workspaceId)),
      )
      .all();
  }
  return db.select().from(skills).all();
}

export async function getUserSkillById(id: string) {
  const [row] = await db.select().from(skills).where(eq(skills.id, id));
  return row ?? null;
}

/**
 * Scope-exact lookup: a workspace scope never falls through to the global
 * skill of the same name. Callers are addressing one row — the skill named
 * `name` living in exactly this scope — not resolving which skill a chat would
 * see (that is `resolveSkillsForChat`, where workspace shadows global).
 */
export async function getUserSkillByName(
  name: string,
  workspaceId?: string | null,
) {
  const [row] = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.name, name),
        workspaceId
          ? eq(skills.workspaceId, workspaceId)
          : isNull(skills.workspaceId),
      ),
    );
  return row ?? null;
}

/** Whether `name` is already used in exactly `workspaceId`'s scope by another row. */
export async function isNameTakenInScope(
  name: string,
  workspaceId: string | null,
  excludeId?: string,
) {
  const existing = await getUserSkillByName(name, workspaceId);
  return !!existing && existing.id !== excludeId;
}

export async function createUserSkill(input: UserSkillCreate) {
  const [row] = await db
    .insert(skills)
    .values({
      ...input,
      workspaceId: input.workspaceId ?? null,
      disableModelInvocation: input.disableModelInvocation ?? false,
    })
    .returning();
  return row;
}

export async function updateUserSkill(id: string, patch: UserSkillUpdate) {
  // `workspaceId: null` is a real value (move to global), so filter on
  // undefined rather than falsiness.
  const set = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(set).length === 0) return getUserSkillById(id);

  const [row] = await db
    .update(skills)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(skills.id, id))
    .returning();
  return row ?? null;
}

export async function deleteUserSkill(id: string) {
  await db.delete(skills).where(eq(skills.id, id));
}
