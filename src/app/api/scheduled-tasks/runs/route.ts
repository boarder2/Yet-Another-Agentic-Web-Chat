import { NextRequest } from 'next/server';
import db from '@/lib/db';
import {
  chats,
  scheduledTasks,
  messages as messagesSchema,
} from '@/lib/db/schema';
import { and, desc, eq, isNotNull, inArray, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '20', 10),
    100,
  );
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // Get runs that belong to existing tasks (inner join effect)
  const runs = await db
    .select({
      id: chats.id,
      title: chats.title,
      createdAt: chats.createdAt,
      focusMode: chats.focusMode,
      scheduledTaskId: chats.scheduledTaskId,
      scheduledRunViewed: chats.scheduledRunViewed,
      taskName: scheduledTasks.name,
      lastRunStatus: scheduledTasks.lastRunStatus,
    })
    .from(chats)
    .innerJoin(scheduledTasks, eq(chats.scheduledTaskId, scheduledTasks.id))
    .where(isNotNull(chats.scheduledTaskId))
    .orderBy(
      desc(
        sql`(SELECT MIN(${messagesSchema.id}) FROM ${messagesSchema} WHERE ${messagesSchema.chatId} = ${chats.id})`,
      ),
    )
    .limit(limit)
    .offset(offset);

  // Get previews for these runs
  if (runs.length > 0) {
    const chatIds = runs.map((r) => r.id);
    const assistantMsgs = await db
      .select({
        chatId: messagesSchema.chatId,
        content: messagesSchema.content,
        metadata: messagesSchema.metadata,
      })
      .from(messagesSchema)
      .where(
        and(
          inArray(messagesSchema.chatId, chatIds),
          eq(messagesSchema.role, 'assistant'),
        ),
      );

    const previewMap = new Map<
      string,
      { preview: string; sourcesCount: number }
    >();
    for (const msg of assistantMsgs) {
      if (!previewMap.has(msg.chatId)) {
        const content = msg.content || '';
        // Strip ToolCall tags for preview
        const cleaned = content
          .replace(/<ToolCall[^>]*>[\s\S]*?<\/ToolCall>/gi, '')
          .replace(
            /<SubagentExecution[^>]*>[\s\S]*?<\/SubagentExecution>/gi,
            '',
          )
          .trim();
        const meta = msg.metadata as Record<string, unknown> | null;
        const sources = (meta?.sources as unknown[] | undefined) || [];
        previewMap.set(msg.chatId, {
          preview: cleaned.slice(0, 200),
          sourcesCount: sources.length,
        });
      }
    }

    return Response.json(
      runs.map((run) => ({
        ...run,
        preview: previewMap.get(run.id)?.preview || '',
        sourcesCount: previewMap.get(run.id)?.sourcesCount || 0,
      })),
    );
  }

  return Response.json(runs);
}
