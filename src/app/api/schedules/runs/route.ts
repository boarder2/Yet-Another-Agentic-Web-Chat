import { NextRequest } from 'next/server';
import db from '@/lib/db';
import {
  chats,
  schedules,
  workflows,
  messages as messagesSchema,
} from '@/lib/db/schema';
import { and, desc, eq, isNotNull, inArray, sql } from 'drizzle-orm';
import { computeSanitizedContent } from '@/lib/db/sanitizedContent';

export const runtime = 'nodejs';

// Scheduled run history: chats stamped with a schedule_id, newest first, with a
// preview + the parent schedule's label and workflow name.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '20', 10),
    100,
  );
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const runs = await db
    .select({
      id: chats.id,
      title: chats.title,
      createdAt: chats.createdAt,
      focusMode: chats.focusMode,
      scheduleId: chats.scheduleId,
      scheduledRunViewed: chats.scheduledRunViewed,
      activeRunMessageId: chats.activeRunMessageId,
      scheduleLabel: schedules.label,
      workflowName: workflows.name,
      lastRunStatus: schedules.lastRunStatus,
    })
    .from(chats)
    .innerJoin(schedules, eq(chats.scheduleId, schedules.id))
    .innerJoin(workflows, eq(schedules.workflowId, workflows.id))
    .where(isNotNull(chats.scheduleId))
    .orderBy(
      desc(
        sql`(SELECT MIN(${messagesSchema.id}) FROM ${messagesSchema} WHERE ${messagesSchema.chatId} = ${chats.id})`,
      ),
    )
    .limit(limit)
    .offset(offset);

  if (runs.length === 0) return Response.json(runs);

  const chatIds = runs.map((r) => r.id);
  const assistantMsgs = await db
    .select({
      chatId: messagesSchema.chatId,
      content: messagesSchema.content,
      sanitizedContent: messagesSchema.sanitizedContent,
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
    if (previewMap.has(msg.chatId)) continue;
    const cleaned = (
      msg.sanitizedContent ?? computeSanitizedContent(msg.content || '')
    ).trim();
    const meta = msg.metadata as Record<string, unknown> | null;
    const sources = (meta?.sources as unknown[] | undefined) || [];
    previewMap.set(msg.chatId, {
      preview: cleaned.slice(0, 200),
      sourcesCount: sources.length,
    });
  }

  return Response.json(
    runs.map((run) => ({
      ...run,
      preview: previewMap.get(run.id)?.preview || '',
      sourcesCount: previewMap.get(run.id)?.sourcesCount || 0,
    })),
  );
}
