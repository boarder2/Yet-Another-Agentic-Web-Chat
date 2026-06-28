import db from '@/lib/db';
import { approvalRequests } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');

    const rows = await db
      .select()
      .from(approvalRequests)
      .where(
        chatId
          ? and(
              isNull(approvalRequests.resolvedAt),
              eq(approvalRequests.chatId, chatId),
            )
          : isNull(approvalRequests.resolvedAt),
      );

    const pending = rows.map((r) => ({
      approvalId: r.id,
      chatId: r.chatId,
      messageId: r.messageId,
      toolKind: r.toolKind,
      createdAt: r.createdAt,
      payload: r.payload,
    }));

    return Response.json({ pending });
  } catch (err) {
    console.error('[/api/approvals/pending] failed:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
