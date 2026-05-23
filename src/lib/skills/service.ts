import db from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { eq, isNull, and, or } from 'drizzle-orm';

export type UserSkillCreate = {
  name: string;
  description: string;
  content: string;
  workspaceId?: string | null;
};

export type UserSkillUpdate = Partial<
  Pick<UserSkillCreate, 'description' | 'content'>
>;

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

export async function getUserSkillByName(
  name: string,
  workspaceId?: string | null,
) {
  const conditions = workspaceId
    ? and(
        eq(skills.name, name),
        or(isNull(skills.workspaceId), eq(skills.workspaceId, workspaceId)),
      )
    : and(eq(skills.name, name), isNull(skills.workspaceId));
  const [row] = await db.select().from(skills).where(conditions!);
  return row ?? null;
}

export async function createUserSkill(input: UserSkillCreate) {
  const [row] = await db
    .insert(skills)
    .values({
      ...input,
      workspaceId: input.workspaceId ?? null,
    })
    .returning();
  return row;
}

export async function updateUserSkill(id: string, patch: UserSkillUpdate) {
  const [row] = await db
    .update(skills)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(skills.id, id))
    .returning();
  return row ?? null;
}

export async function setUserSkillEnabled(id: string, enabled: boolean) {
  const [row] = await db
    .update(skills)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(skills.id, id))
    .returning();
  return row ?? null;
}

export async function deleteUserSkill(id: string) {
  await db.delete(skills).where(eq(skills.id, id));
}
