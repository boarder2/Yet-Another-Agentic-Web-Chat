import db from '@/lib/db';
import { workspaceSystemPrompts, systemPrompts } from '@/lib/db/schema';
import { eq, asc, inArray } from 'drizzle-orm';

export async function listLinks(workspaceId: string) {
  return db
    .select({
      systemPromptId: workspaceSystemPrompts.systemPromptId,
      order: workspaceSystemPrompts.order,
    })
    .from(workspaceSystemPrompts)
    .where(eq(workspaceSystemPrompts.workspaceId, workspaceId))
    .orderBy(asc(workspaceSystemPrompts.order));
}

export async function listLinkedPrompts(workspaceId: string) {
  const links = await listLinks(workspaceId);
  if (links.length === 0) return [];
  const ids = links.map((l) => l.systemPromptId);
  const rows = await db
    .select()
    .from(systemPrompts)
    .where(inArray(systemPrompts.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  return links.map((l) => byId.get(l.systemPromptId)).filter(Boolean);
}

export async function setLinks(workspaceId: string, ids: string[]) {
  await db
    .delete(workspaceSystemPrompts)
    .where(eq(workspaceSystemPrompts.workspaceId, workspaceId));
  if (ids.length > 0) {
    await db.insert(workspaceSystemPrompts).values(
      ids.map((systemPromptId, order) => ({
        workspaceId,
        systemPromptId,
        order,
      })),
    );
  }
}
