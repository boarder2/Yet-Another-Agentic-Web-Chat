import db from '@/lib/db';
import { workspaces } from '@/lib/db/schema';
import { eq, isNull, isNotNull, desc } from 'drizzle-orm';
import type { WorkspaceCreate, WorkspaceUpdate } from './types';

export async function createWorkspace(input: WorkspaceCreate) {
  const [row] = await db
    .insert(workspaces)
    .values({
      ...input,
      sourceUrls: input.sourceUrls ?? [],
    })
    .returning();
  return row;
}

export async function getWorkspace(id: string) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return row ?? null;
}

export async function listWorkspaces({
  archived = false,
}: { archived?: boolean } = {}) {
  return db
    .select()
    .from(workspaces)
    .where(
      archived
        ? isNotNull(workspaces.archivedAt)
        : isNull(workspaces.archivedAt),
    )
    .orderBy(desc(workspaces.updatedAt));
}

export async function updateWorkspace(id: string, patch: WorkspaceUpdate) {
  const [row] = await db
    .update(workspaces)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return row ?? null;
}

export async function archiveWorkspace(id: string) {
  const [row] = await db
    .update(workspaces)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return row ?? null;
}

export async function unarchiveWorkspace(id: string) {
  const [row] = await db
    .update(workspaces)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return row ?? null;
}
