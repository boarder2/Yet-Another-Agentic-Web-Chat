import db from '@/lib/db';
import { messages as messagesSchema } from '@/lib/db/schema';
import { computeSanitizedContent } from './sanitizedContent';
import { eq, isNull } from 'drizzle-orm';

const BATCH_SIZE = 200;

/**
 * One-time, idempotent, restart-safe backfill: derives `sanitizedContent` for
 * every pre-migration row where it's still null. Runs in small batches and
 * yields between them so it never holds the DB or event loop for long; safe
 * to rerun since it only ever touches null rows.
 */
export async function backfillSanitizedContent(): Promise<void> {
  let total = 0;
  for (;;) {
    const rows = await db
      .select({ id: messagesSchema.id, content: messagesSchema.content })
      .from(messagesSchema)
      .where(isNull(messagesSchema.sanitizedContent))
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      await db
        .update(messagesSchema)
        .set({ sanitizedContent: computeSanitizedContent(row.content) })
        .where(eq(messagesSchema.id, row.id))
        .execute();
    }
    total += rows.length;

    // Yield to the event loop between batches.
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (total > 0) {
    console.log(
      `[history] Backfilled sanitizedContent for ${total} message(s).`,
    );
  }
}
