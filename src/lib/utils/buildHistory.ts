import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { messages as messagesSchema } from '@/lib/db/schema';
import { buildMultimodalHumanMessage } from '@/lib/utils/images';
import { encodeHtmlAttribute } from '@/lib/utils/html';

type DbMessageRow = typeof messagesSchema.$inferSelect;

interface SystemRowMetadata {
  kind?: string;
  invoker?: string;
  invokedAt?: string;
  parentMessageId?: string;
}

interface UserRowMetadata {
  images?: string[];
}

const escapeForCdata = (s: string): string =>
  s.replace(/]]>/g, ']]]]><![CDATA[>');

const renderToolEvidence = (rows: DbMessageRow[]): string => {
  const blocks = rows.map((r) => {
    const md = JSON.parse((r.metadata as string) || '{}') as SystemRowMetadata;
    const attrs = [
      `kind="${encodeHtmlAttribute(md.kind ?? 'tool_output')}"`,
      md.invoker ? `invoker="${encodeHtmlAttribute(md.invoker)}"` : null,
      md.invokedAt ? `at="${encodeHtmlAttribute(md.invokedAt)}"` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return `  <output ${attrs}><![CDATA[\n${escapeForCdata(r.content)}\n]]></output>`;
  });
  return `<previous_tool_outputs>\n${blocks.join('\n')}\n</previous_tool_outputs>`;
};

/**
 * Convert DB message rows into LangChain BaseMessages safe to send to any
 * provider (notably Anthropic, which forbids `system` role inside `messages`).
 *
 * Tool/skill outputs stored as `role: 'system'` rows are folded into the
 * assistant turn that produced them (matched by metadata.parentMessageId) as
 * a leading `<previous_tool_outputs>` block. Orphan system rows (no matching
 * assistant in this slice) are dropped.
 */
export function buildHistoryFromDb(rows: DbMessageRow[]): BaseMessage[] {
  const systemByParent = new Map<string, DbMessageRow[]>();
  for (const r of rows) {
    if (r.role !== 'system') continue;
    const md = JSON.parse((r.metadata as string) || '{}') as SystemRowMetadata;
    const parent = md.parentMessageId;
    if (!parent) continue;
    const bucket = systemByParent.get(parent);
    if (bucket) bucket.push(r);
    else systemByParent.set(parent, [r]);
  }

  const out: BaseMessage[] = [];
  for (const msg of rows) {
    if (msg.role === 'system' || msg.role === 'compaction') continue;
    if (msg.role === 'user') {
      const md = JSON.parse(
        (msg.metadata as string) || '{}',
      ) as UserRowMetadata;
      // User-invoked skills attach to the user's messageId, not the assistant's.
      const attachedToUser = systemByParent.get(msg.messageId) ?? [];
      const userPreface = attachedToUser.length
        ? renderToolEvidence(attachedToUser) + '\n\n'
        : '';
      if (md.images && md.images.length > 0) {
        out.push(
          buildMultimodalHumanMessage(userPreface + msg.content, md.images),
        );
      } else {
        out.push(new HumanMessage({ content: userPreface + msg.content }));
      }
      continue;
    }
    // assistant (or any unknown role) → AIMessage with folded tool evidence
    const attached = systemByParent.get(msg.messageId) ?? [];
    const preface = attached.length
      ? renderToolEvidence(attached) + '\n\n'
      : '';
    out.push(new AIMessage({ content: preface + msg.content }));
  }
  return out;
}
