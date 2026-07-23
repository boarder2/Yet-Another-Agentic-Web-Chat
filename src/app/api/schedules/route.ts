import db from '@/lib/db';
import { chats, schedules, workflows } from '@/lib/db/schema';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

export const runtime = 'nodejs';

// All schedules joined to their workflow's name — the Scheduled Tasks tab list.
export async function GET() {
  const rows = await db
    .select({
      id: schedules.id,
      workflowId: schedules.workflowId,
      label: schedules.label,
      cronExpression: schedules.cronExpression,
      timezone: schedules.timezone,
      enabled: schedules.enabled,
      disabledReason: schedules.disabledReason,
      lastRunAt: schedules.lastRunAt,
      lastRunStatus: schedules.lastRunStatus,
      lastRunError: schedules.lastRunError,
      lastRunChatId: schedules.lastRunChatId,
      createdAt: schedules.createdAt,
      workflowName: workflows.name,
    })
    .from(schedules)
    .innerJoin(workflows, eq(schedules.workflowId, workflows.id))
    .orderBy(desc(schedules.createdAt));

  // A schedule is "running" if one of its run chats is still in flight.
  const runningRows = await db
    .selectDistinct({ scheduleId: chats.scheduleId })
    .from(chats)
    .where(
      and(isNotNull(chats.scheduleId), isNotNull(chats.activeRunMessageId)),
    );
  const runningIds = new Set(runningRows.map((r) => r.scheduleId));

  return Response.json(
    rows.map((r) => ({ ...r, running: runningIds.has(r.id) })),
  );
}
