import { NextRequest } from 'next/server';
import { validateCronExpression } from 'cron';
import db from '@/lib/db';
import { chats, schedules, workflows } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseWorkflowTemplate, fillSetErrors } from '@/lib/workflows/template';
import {
  rescheduleSchedule,
  unregisterSchedule,
} from '@/lib/scheduledTasks/scheduler';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const schedule = await db.query.schedules.findFirst({
    where: eq(schedules.id, id),
  });
  if (!schedule) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(schedule);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.schedules.findFirst({
    where: eq(schedules.id, id),
  });
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  if (
    body.cronExpression &&
    !validateCronExpression(body.cronExpression).valid
  ) {
    return Response.json({ error: 'Invalid cron expression' }, { status: 400 });
  }

  // Re-validate the fill-set (whichever is in play after this edit) against the
  // workflow's current params (Decision 7).
  if (body.inputValues !== undefined || body.enabled) {
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, existing.workflowId),
    });
    if (workflow) {
      const values = (body.inputValues ?? existing.inputValues ?? {}) as Record<
        string,
        string | string[]
      >;
      const { fields } = parseWorkflowTemplate(workflow.prompt);
      const missing = fillSetErrors(fields, values);
      if (missing.length > 0) {
        return Response.json(
          { error: 'Incomplete fill-set', missing },
          { status: 400 },
        );
      }
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const allowedFields = [
    'label',
    'inputValues',
    'cronExpression',
    'timezone',
    'enabled',
    'retentionMode',
    'retentionValue',
  ];
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] =
        field === 'enabled' ? (body[field] ? 1 : 0) : body[field];
    }
  }
  // Re-enabling (or editing a re-validated schedule) clears the auto-disable flag.
  if (body.enabled) updates.disabledReason = null;
  if ('retentionMode' in body && body.retentionMode === null) {
    updates.retentionMode = null;
    updates.retentionValue = null;
  }

  await db.update(schedules).set(updates).where(eq(schedules.id, id)).execute();

  const updated = await db.query.schedules.findFirst({
    where: eq(schedules.id, id),
  });
  if (
    updated &&
    (body.cronExpression !== undefined ||
      body.enabled !== undefined ||
      body.timezone !== undefined)
  ) {
    rescheduleSchedule(updated);
  }

  return Response.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  unregisterSchedule(id);
  // Keep past run chats; drop only the run-history link (Decision 19).
  await db
    .update(chats)
    .set({ scheduleId: null })
    .where(eq(chats.scheduleId, id))
    .execute();
  await db.delete(schedules).where(eq(schedules.id, id)).execute();
  return Response.json({ success: true });
}
