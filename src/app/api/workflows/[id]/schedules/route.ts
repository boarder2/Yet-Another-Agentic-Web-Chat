import { NextRequest } from 'next/server';
import { validateCronExpression } from 'cron';
import db from '@/lib/db';
import { schedules, workflows } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { parseWorkflowTemplate, fillSetErrors } from '@/lib/workflows/template';
import { registerSchedule } from '@/lib/scheduledTasks/scheduler';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.workflowId, id))
    .orderBy(desc(schedules.createdAt));
  return Response.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, id),
  });
  if (!workflow) {
    return Response.json({ error: 'Workflow not found' }, { status: 404 });
  }

  if (!body.label || !body.cronExpression) {
    return Response.json(
      { error: 'Missing required fields: label, cronExpression' },
      { status: 400 },
    );
  }
  if (!validateCronExpression(body.cronExpression).valid) {
    return Response.json({ error: 'Invalid cron expression' }, { status: 400 });
  }

  // Decision 7: a schedule's fill-set is validated complete at save time (no
  // human at fire time), against the workflow's current params.
  const inputValues = (body.inputValues ?? {}) as Record<
    string,
    string | string[]
  >;
  const { fields } = parseWorkflowTemplate(workflow.prompt);
  const missing = fillSetErrors(fields, inputValues);
  if (missing.length > 0) {
    return Response.json(
      { error: 'Incomplete fill-set', missing },
      { status: 400 },
    );
  }

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    workflowId: id,
    label: body.label,
    inputValues,
    cronExpression: body.cronExpression,
    timezone: body.timezone || null,
    enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1,
    retentionMode: body.retentionMode || null,
    retentionValue: body.retentionMode ? (body.retentionValue ?? null) : null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schedules).values(row).execute();
  const inserted = await db.query.schedules.findFirst({
    where: (t, { eq: e }) => e(t.id, row.id),
  });
  if (inserted && inserted.enabled) registerSchedule(inserted);

  return Response.json(inserted, { status: 201 });
}
