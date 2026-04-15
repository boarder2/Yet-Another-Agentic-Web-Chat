import { NextRequest } from 'next/server';
import { validateCronExpression } from 'cron';
import db from '@/lib/db';
import { scheduledTasks } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { registerTask } from '@/lib/scheduledTasks/scheduler';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await db
    .select()
    .from(scheduledTasks)
    .orderBy(desc(scheduledTasks.createdAt));
  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (
    !body.name ||
    !body.prompt ||
    !body.cronExpression ||
    !body.chatModel ||
    !body.embeddingModel
  ) {
    return Response.json(
      {
        error:
          'Missing required fields: name, prompt, cronExpression, chatModel, embeddingModel',
      },
      { status: 400 },
    );
  }

  if (!validateCronExpression(body.cronExpression).valid) {
    return Response.json({ error: 'Invalid cron expression' }, { status: 400 });
  }

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    name: body.name,
    prompt: body.prompt,
    focusMode: body.focusMode || 'webSearch',
    sourceUrls: body.sourceUrls || [],
    chatModel: body.chatModel,
    systemModel: body.systemModel || null,
    embeddingModel: body.embeddingModel,
    selectedSystemPromptIds: body.selectedSystemPromptIds || [],
    selectedMethodologyId: body.selectedMethodologyId || null,
    cronExpression: body.cronExpression,
    timezone: body.timezone || null,
    enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(scheduledTasks).values(row).execute();

  const inserted = await db.query.scheduledTasks.findFirst({
    where: (t, { eq }) => eq(t.id, row.id),
  });

  if (inserted && inserted.enabled) {
    registerTask(inserted);
  }

  return Response.json(inserted, { status: 201 });
}
