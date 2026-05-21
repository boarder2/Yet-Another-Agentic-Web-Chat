import { getMessageById } from '@/lib/db/messageLookup';

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

    const result = getMessageById(idNum);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return Response.json({ message: 'Message not found' }, { status: 404 });
      }
      return Response.json({ message: 'Forbidden' }, { status: 403 });
    }

    return Response.json(
      {
        chatId: result.row.chatId,
        chatTitle: result.row.chatTitle,
        role: result.row.role,
        content: result.row.content,
        createdAt: result.row.createdAt,
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
