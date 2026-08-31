import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { chats, workflows } from '@/lib/db/schema';
import { and, desc, isNotNull } from 'drizzle-orm';
import { parseWorkflowTemplate } from '@/lib/workflows/template';
import { parseModelReference } from '@/lib/providers/resolveModels';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await db
    .select()
    .from(workflows)
    .orderBy(desc(workflows.createdAt));

  // A workflow is "running" if one of its manual-run chats is still in flight.
  const runningRows = await db
    .selectDistinct({ workflowId: chats.workflowId })
    .from(chats)
    .where(
      and(isNotNull(chats.workflowId), isNotNull(chats.activeRunMessageId)),
    );
  const runningIds = new Set(runningRows.map((r) => r.workflowId));

  return Response.json(
    rows.map((row) => ({ ...row, running: runningIds.has(row.id) })),
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.name || !body.prompt || !body.chatModel) {
    return Response.json(
      { error: 'Missing required fields: name, prompt, chatModel' },
      { status: 400 },
    );
  }

  let chatModel;
  let systemModel = null;
  try {
    chatModel = parseModelReference(body.chatModel);
    if (body.systemModel !== undefined && body.systemModel !== null) {
      systemModel = parseModelReference(body.systemModel);
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Invalid model reference',
      },
      { status: 400 },
    );
  }

  const { errors } = parseWorkflowTemplate(body.prompt);
  if (errors.length > 0) {
    return Response.json(
      { error: 'Invalid prompt template', parseErrors: errors },
      { status: 400 },
    );
  }

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    name: body.name,
    description: body.description ?? null,
    icon: body.icon ?? null,
    prompt: body.prompt,
    focusMode: body.focusMode || 'webSearch',
    chatModel,
    systemModel,
    selectedSystemPromptIds: body.selectedSystemPromptIds || [],
    selectedMethodologyId: body.selectedMethodologyId || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(workflows).values(row).execute();

  const inserted = await db.query.workflows.findFirst({
    where: (t, { eq }) => eq(t.id, row.id),
  });

  return Response.json(inserted, { status: 201 });
}
