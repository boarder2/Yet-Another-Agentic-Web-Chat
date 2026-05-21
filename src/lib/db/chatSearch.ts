import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

const ONE_DAY_MS = 86_400_000;
const CONTENT_HIT_WEIGHT = 1;
const TITLE_HIT_WEIGHT = 2;
const DEFAULT_EXCERPT_RADIUS = 80;

export interface WorkspaceFilter {
  workspaceId?: string | null;
  workspaceIds?: string[];
}

export function buildWorkspaceCondition({
  workspaceId,
  workspaceIds,
}: WorkspaceFilter): SQL | undefined {
  if (workspaceIds && workspaceIds.length > 0) {
    const realIds = workspaceIds.filter((id) => id !== 'none');
    const includeNone = workspaceIds.includes('none');
    if (realIds.length > 0 && includeNone) {
      return or(inArray(chats.workspaceId, realIds), isNull(chats.workspaceId));
    }
    if (realIds.length > 0) return inArray(chats.workspaceId, realIds);
    if (includeNone) return isNull(chats.workspaceId);
    return undefined;
  }
  if (workspaceId === 'none' || workspaceId === 'null') {
    return isNull(chats.workspaceId);
  }
  if (workspaceId) return eq(chats.workspaceId, workspaceId);
  if (workspaceId === null) return isNull(chats.workspaceId);
  return undefined;
}

export function extractExcerpt(
  content: string,
  keywords: string | string[],
  {
    radius = DEFAULT_EXCERPT_RADIUS,
    ellipsis = '…',
  }: { radius?: number; ellipsis?: string } = {},
): string {
  const kws = Array.isArray(keywords) ? keywords : [keywords];
  const lower = content.toLowerCase();
  let firstIdx = -1;
  let firstLen = 0;
  for (const kw of kws) {
    const k = kw.toLowerCase();
    if (!k) continue;
    const idx = lower.indexOf(k);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
      firstLen = k.length;
    }
  }
  if (firstIdx === -1) {
    const max = radius * 2;
    return content.length > max
      ? content.slice(0, max).trim() + ellipsis
      : content.trim();
  }
  const start = Math.max(0, firstIdx - radius);
  const end = Math.min(content.length, firstIdx + firstLen + radius);
  let excerpt = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) excerpt = ellipsis + excerpt;
  if (end < content.length) excerpt = excerpt + ellipsis;
  return excerpt;
}

export function matchedKeywords(
  content: string | null | undefined,
  title: string | null | undefined,
  keywords: string[],
): string[] {
  const c = (content ?? '').toLowerCase();
  const t = (title ?? '').toLowerCase();
  return keywords.filter((kw) => {
    const k = kw.toLowerCase();
    return !!k && (c.includes(k) || t.includes(k));
  });
}

export interface ChatSearchOptions extends WorkspaceFilter {
  keywords: string[];
  excludeChatId?: string;
  includePrivate?: boolean;
  includeCompaction?: boolean;
  after?: string | number;
  before?: string | number;
  limit?: number;
}

export interface ChatSearchRow {
  chatId: string;
  chatTitle: string;
  chatCreatedAt: number;
  messageId: number | null;
  messageRole: string | null;
  messageContent: string | null;
  messageCreatedAt: string | null;
  score: number;
  matchedKeywords: string[];
}

function escapeLikePattern(kw: string): string {
  return (
    '%' +
    kw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') +
    '%'
  );
}

function toEpochMs(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return isNaN(t) ? undefined : t;
}

export async function searchChatsByKeywords(
  opts: ChatSearchOptions,
): Promise<ChatSearchRow[]> {
  const keywords = opts.keywords.map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) return [];

  const limit = opts.limit ?? 20;
  const patterns = keywords.map((kw) => escapeLikePattern(kw.toLowerCase()));

  const contentScoreParts = patterns.map(
    (p) =>
      sql`(CASE WHEN lower(coalesce(${messages.content}, '')) LIKE ${p} THEN ${CONTENT_HIT_WEIGHT} ELSE 0 END)`,
  );
  const titleScoreParts = patterns.map(
    (p) =>
      sql`(CASE WHEN lower(${chats.title}) LIKE ${p} THEN ${TITLE_HIT_WEIGHT} ELSE 0 END)`,
  );
  const rowScoreExpr = sql.join(
    [...contentScoreParts, ...titleScoreParts],
    sql` + `,
  );

  const anyMatchParts = patterns.flatMap((p) => [
    like(sql`lower(coalesce(${messages.content}, ''))`, p),
    like(sql`lower(${chats.title})`, p),
  ]);

  const conditions: SQL[] = [];
  const ws = buildWorkspaceCondition(opts);
  if (ws) conditions.push(ws);
  if (opts.excludeChatId) conditions.push(ne(chats.id, opts.excludeChatId));
  if (!opts.includePrivate) {
    const privateCond = or(isNull(chats.isPrivate), eq(chats.isPrivate, 0));
    if (privateCond) conditions.push(privateCond);
  }
  if (!opts.includeCompaction) {
    const compactionCond = or(
      isNull(messages.role),
      ne(messages.role, 'compaction'),
    );
    if (compactionCond) conditions.push(compactionCond);
  }
  const anyMatch = or(...anyMatchParts);
  if (anyMatch) conditions.push(anyMatch);

  const after = toEpochMs(opts.after);
  const before = toEpochMs(opts.before);
  if (after !== undefined) conditions.push(gte(chats.createdAt, after));
  if (before !== undefined)
    conditions.push(lte(chats.createdAt, before + ONE_DAY_MS));

  const rows = await db
    .select({
      chatId: chats.id,
      chatTitle: chats.title,
      chatCreatedAt: chats.createdAt,
      messageId: messages.id,
      messageRole: messages.role,
      messageContent: messages.content,
      messageCreatedAt: sql<
        string | null
      >`json_extract(${messages.metadata}, '$.createdAt')`,
      rowScore: sql<number>`(${rowScoreExpr})`.as('row_score'),
    })
    .from(chats)
    .leftJoin(messages, eq(messages.chatId, chats.id))
    .where(and(...conditions))
    .orderBy(desc(sql`row_score`), desc(chats.createdAt), desc(messages.id));

  const bestByChat = new Map<string, ChatSearchRow>();
  for (const row of rows) {
    if (bestByChat.has(row.chatId)) continue;
    bestByChat.set(row.chatId, {
      chatId: row.chatId,
      chatTitle: row.chatTitle,
      chatCreatedAt: row.chatCreatedAt,
      messageId: row.messageId,
      messageRole: row.messageRole,
      messageContent: row.messageContent,
      messageCreatedAt: row.messageCreatedAt,
      score: row.rowScore,
      matchedKeywords: matchedKeywords(
        row.messageContent,
        row.chatTitle,
        keywords,
      ),
    });
    if (bestByChat.size >= limit) break;
  }

  return Array.from(bestByChat.values());
}

export async function getMessageCounts(
  chatIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (chatIds.length === 0) return counts;
  const rows = await db
    .select({
      chatId: messages.chatId,
      count: sql<number>`count(*)`,
    })
    .from(messages)
    .where(inArray(messages.chatId, chatIds))
    .groupBy(messages.chatId);
  for (const r of rows) counts.set(r.chatId, Number(r.count));
  return counts;
}
