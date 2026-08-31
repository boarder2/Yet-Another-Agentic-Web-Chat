import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { chats, schedules, workflows } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { parseWorkflowTemplate, fillSetErrors } from '@/lib/workflows/template';
import { unregisterSchedule } from '@/lib/scheduledTasks/scheduler';
import { parseModelReference } from '@/lib/providers/resolveModels';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });
  if (!workflow) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(workflow);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  if (body.chatModel !== undefined) {
    try {
      body.chatModel = parseModelReference(body.chatModel);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : 'Invalid model reference',
        },
        { status: 400 },
      );
    }
  }
  if (body.systemModel !== undefined && body.systemModel !== null) {
    try {
      body.systemModel = parseModelReference(body.systemModel);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : 'Invalid model reference',
        },
        { status: 400 },
      );
    }
  }

  if (body.prompt !== undefined) {
    const { errors } = parseWorkflowTemplate(body.prompt);
    if (errors.length > 0) {
      return Response.json(
        { error: 'Invalid prompt template', parseErrors: errors },
        { status: 400 },
      );
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const allowedFields = [
    'name',
    'description',
    'icon',
    'prompt',
    'focusMode',
    'chatModel',
    'systemModel',
    'selectedSystemPromptIds',
    'selectedMethodologyId',
  ];
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  await db.update(workflows).set(updates).where(eq(workflows.id, id)).execute();

  // Decision 18: a prompt edit that invalidates a child schedule's saved
  // fill-set auto-disables that schedule (never silently reconciled). Re-parse
  // once and re-validate every child's stored fill-set against the new params.
  if (body.prompt !== undefined) {
    const { fields } = parseWorkflowTemplate(body.prompt);
    const children = await db
      .select()
      .from(schedules)
      .where(eq(schedules.workflowId, id));
    for (const child of children) {
      const missing = fillSetErrors(fields, child.inputValues ?? {});
      const shouldDisable = missing.length > 0;
      if (shouldDisable && child.enabled) {
        await db
          .update(schedules)
          .set({
            enabled: 0,
            disabledReason: `Auto-disabled: workflow edit left this schedule's fill-set invalid (${missing.join(', ')}).`,
            updatedAt: new Date(),
          })
          .where(eq(schedules.id, child.id))
          .execute();
        unregisterSchedule(child.id);
      }
    }
  }

  const updated = await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });
  return Response.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Cascade-delete schedules (Decision 19). The FK cascade removes the rows;
  // we stop their cron jobs first and null the provenance on surviving chats
  // (chats carry no DB-level FK, so keep them by hand).
  const children = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.workflowId, id));
  const scheduleIds = children.map((c) => c.id);

  for (const sid of scheduleIds) unregisterSchedule(sid);
  if (scheduleIds.length > 0) {
    await db
      .update(chats)
      .set({ scheduleId: null })
      .where(inArray(chats.scheduleId, scheduleIds))
      .execute();
  }
  await db
    .update(chats)
    .set({ workflowId: null })
    .where(eq(chats.workflowId, id))
    .execute();

  await db.delete(workflows).where(eq(workflows.id, id)).execute();

  return Response.json({ success: true, deletedSchedules: scheduleIds.length });
}
