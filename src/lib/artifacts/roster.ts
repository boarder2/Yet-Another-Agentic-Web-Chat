import db from '@/lib/db';
import { messages } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { scanArtifactMentions } from './mention';
import {
  listRosterArtifacts,
  type ArtifactScope,
  type ArtifactSummary,
} from './service';

/**
 * The artifacts this chat knows about: the ones it created, plus the ones the
 * user mentioned in it. Mentions are read back out of the persisted user
 * messages rather than tracked separately, so the set can never drift from the
 * transcript — and `listRosterArtifacts` drops any id the scope can't reach,
 * so a stale or hand-typed one simply doesn't appear.
 */
export function listChatRoster(scope: ArtifactScope): ArtifactSummary[] {
  const rows = db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.chatId, scope.chatId), eq(messages.role, 'user')))
    .all();
  const mentioned = new Set<string>();
  for (const r of rows) {
    for (const id of scanArtifactMentions(r.content)) mentioned.add(id);
  }
  return listRosterArtifacts(scope, [...mentioned]);
}
