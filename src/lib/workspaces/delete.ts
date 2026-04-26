import db from '@/lib/db';
import {
  workspaces,
  workspaceFiles,
  workspaceSystemPrompts,
  chats,
  memories,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { blobPath, WORKSPACE_FILES_ROOT } from './paths';
import fs from 'fs';
import path from 'path';

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  // 1. Collect all blob hashes used by this workspace's files
  const files = await db
    .select({ sha256: workspaceFiles.sha256 })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspaceId))
    .all();

  // 2. Delete all DB rows in dependency order
  await db
    .delete(workspaceSystemPrompts)
    .where(eq(workspaceSystemPrompts.workspaceId, workspaceId))
    .execute();
  await db
    .delete(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspaceId))
    .execute();

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

  // 3. GC blobs that are now unreferenced across all workspaces
  for (const { sha256 } of files) {
    const stillUsed = await db
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.sha256, sha256))
      .get();
    if (!stillUsed) {
      const blobFile = path.join(WORKSPACE_FILES_ROOT, blobPath(sha256));
      try {
        fs.unlinkSync(blobFile);
      } catch {
        // already gone — ignore
      }
    }
  }
}
