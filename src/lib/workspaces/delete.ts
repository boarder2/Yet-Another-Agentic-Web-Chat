import db from '@/lib/db';
import {
  workspaces,
  workspaceFiles,
  workspaceSystemPrompts,
  mcpServerWorkspaces,
  chats,
  memories,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { workspaceDir } from './paths';
import { deleteForWorkspace as deleteHistoryForWorkspace } from '@/lib/history/service';
import fs from 'node:fs/promises';

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await db
    .delete(workspaceSystemPrompts)
    .where(eq(workspaceSystemPrompts.workspaceId, workspaceId))
    .execute();
  await db
    .delete(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspaceId))
    .execute();
  await db
    .delete(mcpServerWorkspaces)
    .where(eq(mcpServerWorkspaces.workspaceId, workspaceId))
    .execute();

  // Documents the workspace owns go with it — unlike the chats below, they have
  // no life outside it.
  deleteHistoryForWorkspace(workspaceId);

  // Detach chats from workspace (don't delete the chats themselves)
  await db
    .update(chats)
    .set({ workspaceId: null })
    .where(eq(chats.workspaceId, workspaceId))
    .execute();

  // Detach memories from workspace (don't delete them)
  await db
    .update(memories)
    .set({ workspaceId: null })
    .where(eq(memories.workspaceId, workspaceId))
    .execute();

  await db.delete(workspaces).where(eq(workspaces.id, workspaceId)).execute();

  // No blob is shared across workspaces, so the whole tree goes — including any
  // orphans left behind by a crash mid-write.
  await fs.rm(workspaceDir(workspaceId), { recursive: true, force: true });
}
