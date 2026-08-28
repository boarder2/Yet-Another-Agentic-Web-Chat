import db from '@/lib/db';
import { approvalRequests, chats } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import {
  isLocationApprovalExpired,
  isLocationApprovalWindowBounded,
  LocationApprovalPayloadSchema,
} from '@/lib/maps/locationSessions';
import {
  expireLocationApproval,
  markLocationApprovalStale,
  resumeLocationApprovalStale,
} from '@/lib/runs/runHost';

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

    type PendingApproval = {
      approvalId: string;
      chatId: string;
      messageId: string;
      toolKind: (typeof approvalRequests.$inferSelect)['toolKind'];
      createdAt: number;
      payload: unknown;
    };
    const pending: PendingApproval[] = [];
    for (const r of rows) {
      if (r.toolKind !== 'location') {
        pending.push({
          approvalId: r.id,
          chatId: r.chatId,
          messageId: r.messageId,
          toolKind: r.toolKind,
          createdAt: r.createdAt,
          payload: r.payload,
        });
        continue;
      }
      // A location approval never carries an external snapshot or a response
      // while pending. Treat legacy/tampered rows as stale before exposing even
      // their disclosure payload to a browser.
      if (r.snapshot != null || r.response != null) {
        await resumeLocationApprovalStale(
          r.id,
          'Location approval data is invalid; ask for a named origin instead.',
        ).catch(() =>
          markLocationApprovalStale(
            r.id,
            'Location approval data is invalid; ask for a named origin instead.',
          ),
        );
        continue;
      }
      const parsed = LocationApprovalPayloadSchema.safeParse(r.payload);
      if (!parsed.success) {
        await resumeLocationApprovalStale(
          r.id,
          'Location approval data is invalid; ask for a named origin instead.',
        ).catch(() =>
          markLocationApprovalStale(
            r.id,
            'Location approval data is invalid; ask for a named origin instead.',
          ),
        );
        continue;
      }
      if (!isLocationApprovalWindowBounded(parsed.data)) {
        await resumeLocationApprovalStale(
          r.id,
          'Location approval data is invalid; ask for a named origin instead.',
        ).catch(() =>
          markLocationApprovalStale(
            r.id,
            'Location approval data is invalid; ask for a named origin instead.',
          ),
        );
        continue;
      }
      if (isLocationApprovalExpired(parsed.data)) {
        // An abandoned browser prompt must not leave its graph paused forever.
        // The server resumes it with a coordinate-free denial when possible.
        await expireLocationApproval(r.id).catch(() =>
          markLocationApprovalStale(
            r.id,
            'Location approval expired; ask for a named origin instead.',
          ),
        );
        continue;
      }
      // Location payloads are explicitly allow-listed so a malformed or legacy
      // row cannot leak a coordinate/token through the generic pending route.
      // Private chats also force the retention choice off at this boundary;
      // the UI check is only a second line of defense.
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, r.chatId),
      });
      pending.push({
        approvalId: r.id,
        chatId: r.chatId,
        messageId: r.messageId,
        toolKind: r.toolKind,
        createdAt: r.createdAt,
        payload:
          chat?.isPrivate === 1
            ? { ...parsed.data, allowSave: false }
            : parsed.data,
      });
    }

    return Response.json({ pending });
  } catch (err) {
    console.error('[/api/approvals/pending] failed:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
