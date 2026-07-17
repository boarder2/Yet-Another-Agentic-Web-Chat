import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { deleteChatWithOrphanCleanup } from '@/lib/retention/deleteChat';

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();

    // A rename is a deliberate title choice, so lock it against future
    // auto-title regeneration.
    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) {
        return Response.json(
          { message: 'title must not be empty' },
          { status: 400 },
        );
      }
      if (title.length > 200) {
        return Response.json(
          { message: 'title must be 200 characters or fewer' },
          { status: 400 },
        );
      }
      await db
        .update(chats)
        .set({ title, titleLocked: 1 })
        .where(eq(chats.id, id));
      return Response.json({ ok: true });
    }

    if (typeof body.pinned === 'boolean') {
      await db
        .update(chats)
        .set({ pinned: body.pinned ? 1 : 0 })
        .where(eq(chats.id, id));
      return Response.json({ ok: true });
    }

    return Response.json(
      { message: 'expected a title (string) or pinned (boolean)' },
      { status: 400 },
    );
  } catch (err) {
    console.error('Error updating chat:', err);
    return Response.json({ message: 'error' }, { status: 500 });
  }
};

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    const chatExists = await db.query.chats.findFirst({
      where: eq(chats.id, id),
    });

    if (!chatExists) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    const chatMessages = await db.query.messages.findMany({
      where: and(eq(messages.chatId, id), ne(messages.role, 'system')),
      // sanitizedContent is an internal derived column for history search —
      // never returned by chat/History APIs.
      columns: { sanitizedContent: false },
    });

    return Response.json(
      {
        chat: chatExists,
        messages: chatMessages,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in getting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    const chatExists = await db.query.chats.findFirst({
      where: eq(chats.id, id),
    });

    if (!chatExists) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    deleteChatWithOrphanCleanup(id);

    return Response.json(
      { message: 'Chat deleted successfully' },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in deleting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
