import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) => {
  try {
    const { messageId } = await params;
    const idNum = Number(messageId);
    if (!Number.isInteger(idNum)) {
      return Response.json({ message: 'Invalid messageId' }, { status: 400 });
    }

    const row = db
      .select({
        content: messages.content,
        role: messages.role,
        metadata: messages.metadata,
        chatId: messages.chatId,
        chatTitle: chats.title,
        isPrivate: chats.isPrivate,
      })
      .from(messages)
      .leftJoin(chats, eq(chats.id, messages.chatId))
      .where(eq(messages.id, idNum))
      .get();

    if (!row) {
      return Response.json({ message: 'Message not found' }, { status: 404 });
    }
    if (row.isPrivate === 1) {
      return Response.json({ message: 'Forbidden' }, { status: 403 });
    }
    if (row.role === 'compaction') {
      return Response.json({ message: 'Forbidden' }, { status: 403 });
    }

    let createdAt: string | null = null;
    if (row.metadata && typeof row.metadata === 'object') {
      const meta = row.metadata as Record<string, unknown>;
      if (typeof meta.createdAt === 'string') createdAt = meta.createdAt;
    }

    return Response.json(
      {
        chatId: row.chatId,
        chatTitle: row.chatTitle,
        role: row.role,
        content: row.content,
        createdAt,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error fetching message by id:', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
