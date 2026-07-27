import db from '@/lib/db';
import { systemPrompts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { badRequest, notFound, route } from '@/lib/api/route';

type Ctx = { params: Promise<{ id: string }> };

const VALID_TYPES = ['persona', 'methodology'];

export const PUT = route(
  'Failed to update prompt',
  async (req: Request, { params }: Ctx) => {
    const { id } = await params;
    const { name, content, type } = await req.json();
    if (!name || !content) throw badRequest('Name and content are required');

    const updated = await db
      .update(systemPrompts)
      .set({
        name,
        content,
        updatedAt: new Date(),
        ...(VALID_TYPES.includes(type) && { type }),
      })
      .where(eq(systemPrompts.id, id))
      .returning();

    if (!updated.length) throw notFound('Prompt not found');
    return Response.json(updated[0]);
  },
);

export const DELETE = route(
  'Failed to delete prompt',
  async (_req: Request, { params }: Ctx) => {
    const { id } = await params;
    const deleted = await db
      .delete(systemPrompts)
      .where(eq(systemPrompts.id, id))
      .returning();

    if (!deleted.length) throw notFound('Prompt not found');
    return Response.json({ message: 'Prompt deleted successfully' });
  },
);
