import db from '@/lib/db';
import { mcpServerWorkspaces } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function listScopedWorkspaceIds(
  serverId: string,
): Promise<string[]> {
  const rows = await db
    .select({ workspaceId: mcpServerWorkspaces.workspaceId })
    .from(mcpServerWorkspaces)
    .where(eq(mcpServerWorkspaces.serverId, serverId));
  return rows.map((r) => r.workspaceId);
}

export async function setScopedWorkspaceIds(
  serverId: string,
  workspaceIds: string[],
): Promise<void> {
  // Transactional: an invalid workspace id must fail the whole replace, not
  // delete the existing scope and then fail the insert (which would silently
  // leave the server unscoped — visible everywhere — until fixed).
  db.transaction((tx) => {
    tx.delete(mcpServerWorkspaces)
      .where(eq(mcpServerWorkspaces.serverId, serverId))
      .run();
    if (workspaceIds.length > 0) {
      tx.insert(mcpServerWorkspaces)
        .values(workspaceIds.map((workspaceId) => ({ serverId, workspaceId })))
        .run();
    }
  });
}
