import db from '@/lib/db';
import { workspaces } from '@/lib/db/schema';
import { eq, isNull, isNotNull, desc } from 'drizzle-orm';
import {
  parseWorkspaceModelOverride,
  WorkspaceInputValidationError,
  type WorkspaceCreate,
  type WorkspaceUpdate,
} from './types';

function normalizeWorkspaceInput<T extends WorkspaceCreate | WorkspaceUpdate>(
  input: T,
): T {
  if (input.modelOverride === undefined || input.modelOverride === null) {
    return input;
  }
  try {
    return {
      ...input,
      modelOverride: parseWorkspaceModelOverride(input.modelOverride),
    } as T;
  } catch (error) {
    throw new WorkspaceInputValidationError(
      error instanceof Error
        ? error.message
        : 'Invalid workspace model override.',
    );
  }
}

export async function createWorkspace(input: WorkspaceCreate) {
  const [row] = await db
    .insert(workspaces)
    .values(normalizeWorkspaceInput(input))
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
    .set({ ...normalizeWorkspaceInput(patch), updatedAt: new Date() })
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
