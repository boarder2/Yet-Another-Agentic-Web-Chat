import db from '@/lib/db';
import { messages as messagesSchema } from '@/lib/db/schema';
import { getChatMessages, getCompactionRows } from '@/lib/db/queries';
import { resolveChatAndEmbedding } from '@/lib/providers/resolveModels';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CompactBody = {
  chatId: string;
  instructions?: string;
  chatModel?: { provider: string; name: string; contextWindowSize?: number };
  systemModel?: { provider: string; name: string; contextWindowSize?: number };
};

const KEEP_LAST_N = 8;

/** Matches the context-usage estimate shown in the UI (ChatWindow contextUsage). */
function computeContextUsage(
  msgs: { content: unknown; metadata: unknown }[],
): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const metadata = JSON.parse((msgs[i].metadata as string) || '{}');
    const stats = metadata.modelStats;
    if (stats?.firstChatCallInputTokens) {
      const outputEstimate = Math.round(
        ((msgs[i].content as string)?.length || 0) / 4,
      );
      return stats.firstChatCallInputTokens + outputEstimate;
    }
  }
  const contentChars = msgs.reduce(
    (sum, m) => sum + ((m.content as string)?.length || 0),
    0,
  );
  return Math.round(contentChars / 4) + 3000;
}

const SUMMARIZE_PROMPT = `You are summarizing a conversation for another LLM. Below is the full conversation since the last compaction (or the start of the chat).

The LAST ${KEEP_LAST_N} MESSAGES of this conversation will be preserved VERBATIM alongside your summary — they are included here so you can see what's already covered, but you do NOT need to repeat their content.
Your summary replaces only messages that come BEFORE those last ${KEEP_LAST_N} turns.

Write a dense, factual briefing, not a narrative. Preserve:
- User preferences, constraints, and working style
- Decisions made and their rationale
- Code patterns, file paths, and architectural choices discussed
- Errors encountered and their solutions
- Pending tasks, follow-ups, and unresolved questions

Skip narration, transitions, and meta-commentary ("The user asked...", "The assistant then..."). Do not repeat details that the verbatim messages already capture.`;

export const POST = async (req: Request) => {
  try {
    const body = (await req.json()) as CompactBody;
    const { chatId, instructions } = body;

    if (!chatId) {
      return Response.json({ error: 'chatId is required' }, { status: 400 });
    }

    const messages = await getChatMessages(chatId);
    if (messages.length <= KEEP_LAST_N) {
      return Response.json({
        compactedMessageCount: 0,
        message:
          'Not enough messages to compact. Keep chatting to build up history.',
      });
    }

    // Calculate tokens before compaction — same logic as the UI context indicator
    const tokensBefore = computeContextUsage(messages);

    // Split: keep last KEEP_LAST_N messages verbatim, compact the rest
    const compactableMessages = messages.slice(0, -KEEP_LAST_N);
    const lastCompactedId =
      compactableMessages[compactableMessages.length - 1]?.id || 0;
    // The position where the marker should be displayed: after the last message
    // in the chat at the time compact was triggered (not just after the last
    // compacted message — the kept messages are verbatim and appear after it).
    const positionId = messages[messages.length - 1]?.id || lastCompactedId;

    // Build conversation text from ALL messages (including the verbatim
    // tail) so the summarizer sees what's already covered and can avoid
    // repeating it.
    const buildConversationText = (msgs: typeof messages): string =>
      msgs
        .map((msg) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          return `${role}: ${msg.content}`;
        })
        .join('\n\n');

    let conversationText = buildConversationText(messages);

    // Check for existing compaction checkpoints. The meaningful one is
    // the most recent checkpoint created at an EARLIER position — only
    // that represents a genuine prior compaction we can build upon.
    // A checkpoint at the current position is one we're replacing.
    const existingRows = await getCompactionRows(chatId);
    const earlierCheckpoint = existingRows
      .filter((row) => {
        const meta = JSON.parse((row.metadata as string) || '{}');
        return (
          typeof meta.positionId === 'number' && meta.positionId < positionId
        );
      })
      .at(-1);
    const existingSummary = earlierCheckpoint?.content;

    // Delete any checkpoint at the current position — it's being replaced.
    for (const row of existingRows) {
      const meta = JSON.parse((row.metadata as string) || '{}');
      if (meta.positionId === positionId) {
        await db
          .delete(messagesSchema)
          .where(eq(messagesSchema.messageId, row.messageId))
          .execute();
      }
    }

    // Build system prompt. On re-compaction, embed the previous summary
    // so the model is told to preserve it rather than re-compress it.
    let systemPrompt = SUMMARIZE_PROMPT;

    if (existingSummary && earlierCheckpoint) {
      const earlierMeta = JSON.parse(
        (earlierCheckpoint.metadata as string) || '{}',
      ) as Record<string, unknown>;
      const prevCompactedUpTo = earlierMeta.compactedUpTo as number | undefined;
      // Only send messages since the earlier checkpoint — the rest are
      // already covered by its summary
      if (typeof prevCompactedUpTo === 'number') {
        const newMessages = messages.filter((m) => m.id > prevCompactedUpTo);
        conversationText = buildConversationText(newMessages);
      }
      // Legacy checkpoint (non-numeric compactedUpTo): use all messages

      systemPrompt = `${systemPrompt}

=== PREVIOUS COMPACTION SUMMARY ===
The following is the summary from the last compaction.
Every fact, decision, preference, and file path below MUST be preserved in your new summary (unless explicitly contradicted by newer messages).

---

${existingSummary}
=== END PREVIOUS SUMMARY ===`;
    }

    if (instructions) {
      systemPrompt = `${systemPrompt}\n\nAdditional user instructions for this summary:\n${instructions}`;
    }

    // Resolve system model for summarization
    let summary: string;
    try {
      const resolved = await resolveChatAndEmbedding({
        chatModel: body.chatModel || undefined,
        systemModel: body.systemModel || body.chatModel || undefined,
      });
      const summarizer = resolved.systemLlm;

      const response = await summarizer.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(conversationText),
      ]);

      summary =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
    } catch (err) {
      console.error('Compaction summarization failed:', err);
      return Response.json(
        { error: 'Failed to generate summary' },
        { status: 500 },
      );
    }

    // Count compacted messages and compute tokens after.
    // Baseline (tokensBefore) uses firstChatCallInputTokens from the newest
    // message plus an output estimate — same calculation the UI shows.
    // To estimate the post-compaction context, subtract the compacted messages'
    // contribution and add the summary's.
    const compactedMessageCount = compactableMessages.length;
    const compactedContentTokens = compactableMessages.reduce(
      (sum, m) => sum + Math.round(((m.content as string)?.length || 0) / 4),
      0,
    );
    const summaryTokens = Math.ceil(summary.length / 4);
    const tokensAfter = tokensBefore - compactedContentTokens + summaryTokens;

    const compactedAt = new Date().toISOString();

    console.log(
      `[DEBUG][compact] Storing compaction: chatId=${chatId}, lastCompactedId=${lastCompactedId}, compactedMessageCount=${compactedMessageCount}, messageIds=[${compactableMessages.map((m) => m.id).join(',')}]`,
    );

    await db
      .insert(messagesSchema)
      .values({
        content: summary,
        chatId,
        messageId: `compaction-${crypto.randomBytes(7).toString('hex')}`,
        role: 'compaction',
        metadata: JSON.stringify({
          compactedUpTo: lastCompactedId,
          positionId,
          compactedAt,
          compactedMessageCount,
          tokensBefore,
          tokensAfter,
        }),
      })
      .execute();

    return Response.json({
      compactionSummary: summary,
      compactedMessageCount,
      lastCompactedId,
      tokensBefore,
      tokensAfter,
    });
  } catch (err) {
    console.error('Compaction error:', err);
    return Response.json(
      { error: 'An error occurred during compaction' },
      { status: 500 },
    );
  }
};
