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
  await db
    .delete(mcpServerWorkspaces)
    .where(eq(mcpServerWorkspaces.serverId, serverId));
  if (workspaceIds.length > 0) {
    await db
      .insert(mcpServerWorkspaces)
      .values(workspaceIds.map((workspaceId) => ({ serverId, workspaceId })));
  }
}
