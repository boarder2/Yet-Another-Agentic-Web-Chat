import { NextRequest } from 'next/server';
import { validateCronExpression } from 'cron';
import db from '@/lib/db';
import { scheduledTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rescheduleTask, unregisterTask } from '@/lib/scheduledTasks/scheduler';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, id),
  });

  if (!task) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json(task);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, id),
  });

  if (!existing) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  if (
    body.cronExpression &&
    !validateCronExpression(body.cronExpression).valid
  ) {
    return Response.json({ error: 'Invalid cron expression' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  const allowedFields = [
    'name',
    'prompt',
    'focusMode',
    'sourceUrls',
    'chatModel',
    'systemModel',
    'embeddingModel',
    'selectedSystemPromptIds',
    'selectedMethodologyId',
    'cronExpression',
    'timezone',
    'enabled',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === 'enabled') {
        updates[field] = body[field] ? 1 : 0;
      } else {
        updates[field] = body[field];
      }
    }
  }

  await db
    .update(scheduledTasks)
    .set(updates)
    .where(eq(scheduledTasks.id, id))
    .execute();

  const updated = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, id),
  });

  // Reschedule if schedule-affecting fields changed
  if (
    updated &&
    (body.cronExpression !== undefined ||
      body.enabled !== undefined ||
      body.timezone !== undefined)
  ) {
    rescheduleTask(updated);
  }

  return Response.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  unregisterTask(id);

  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).execute();

  return Response.json({ success: true });
}
