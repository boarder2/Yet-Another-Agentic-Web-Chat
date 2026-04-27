import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { deleteChatWithOrphanCleanup } from '@/lib/retention/deleteChat';

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    if (typeof body.pinned !== 'boolean') {
      return Response.json(
        { message: 'pinned must be boolean' },
        { status: 400 },
      );
    }
    await db
      .update(chats)
      .set({ pinned: body.pinned ? 1 : 0 })
      .where(eq(chats.id, id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Error updating chat pin:', err);
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
      where: eq(messages.chatId, id),
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
