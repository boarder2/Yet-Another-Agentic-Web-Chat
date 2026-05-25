import db from '@/lib/db';
import { messages as messagesSchema } from '@/lib/db/schema';
import crypto from 'crypto';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { EventEmitter } from 'events';
import { getRunContext } from '@/lib/skills/runStore';

const runTotals = new Map<string, number>();

export function getContextGrewTotal(runId: string): number {
  return runTotals.get(runId) ?? 0;
}

export function resetContextGrewTotal(runId: string): void {
  runTotals.delete(runId);
}

export const PERSIST_CAP_BYTES = 64 * 1024;

export type ContextRowKind =
  | 'skill_invocation'
  | 'url_fetch'
  | 'pdf_loader'
  | 'youtube_transcript'
  | 'web_search'
  | 'image_search'
  | 'file_search'
  | 'deep_research'
  | 'chat_history_search'
  | 'workspace_read'
  | 'workspace_grep'
  | 'workspace_ls'
  | 'code_execution';

export interface PersistToolContextRowArgs {
  chatId: string;
  parentMessageId: string;
  kind: ContextRowKind;
  metadataExtras?: Record<string, unknown>;
  body: string;
  invoker: 'user' | 'agent';
}

export interface PersistToolContextRowResult {
  insertedId: number;
  persistedTokens: number;
}

function applyCap(body: string): string {
  const buf = Buffer.from(body, 'utf8');
  if (buf.byteLength <= PERSIST_CAP_BYTES) return body;
  const head = buf.subarray(0, PERSIST_CAP_BYTES).toString('utf8');
  return (
    head +
    `\n\n...[truncated by context manager. Original was ${body.length} chars. Agent can re-fetch via the same tool call if more content is needed.]`
  );
}

/**
 * Persist a tool/skill output as a `system` row attached to the current turn.
 *
 * IMPORTANT: The tool's in-turn return value to the model is always the full
 * uncapped content. The cap applied here is for persistence only — subsequent
 * turns replay the (possibly truncated) row.
 */
export async function persistToolContextRow(
  args: PersistToolContextRowArgs,
): Promise<PersistToolContextRowResult> {
  const { chatId, parentMessageId, kind, metadataExtras, body, invoker } = args;

  const capped = applyCap(body);
  const persistedTokens = Math.round(capped.length / 4);
  const messageId = `sys-${crypto.randomBytes(7).toString('hex')}`;

  const inserted = await db
    .insert(messagesSchema)
    .values({
      content: capped,
      chatId,
      messageId,
      role: 'system',
      metadata: JSON.stringify({
        kind,
        invoker,
        invokedAt: new Date().toISOString(),
        parentMessageId,
        ...metadataExtras,
      }),
    })
    .returning({ id: messagesSchema.id });

  const insertedId = inserted[0]?.id ?? 0;
  return { insertedId, persistedTokens };
}

/**
 * Tool-side convenience: pull runId/chatId/parentMessageId from RunnableConfig,
 * persist a context row, and emit a `context_grew` SSE event on the agent's
 * emitter so the UI can flash an inflation badge live during the turn.
 *
 * Best-effort: failures are logged but never throw — context persistence must
 * never break tool execution.
 */
export async function persistFromToolConfig(args: {
  config?: RunnableConfig;
  kind: ContextRowKind;
  body: string;
  metadataExtras?: Record<string, unknown>;
}): Promise<void> {
  const { config, kind, body, metadataExtras } = args;
  if (!config?.configurable) return;
  const runId = config.configurable.runId as string | undefined;
  if (!runId) return;
  const ctx = getRunContext(runId);
  if (!ctx || !ctx.chatId || !ctx.parentMessageId) return;

  try {
    const { persistedTokens } = await persistToolContextRow({
      chatId: ctx.chatId,
      parentMessageId: ctx.parentMessageId,
      kind,
      invoker: 'agent',
      body,
      metadataExtras,
    });

    const running = (runTotals.get(runId) ?? 0) + persistedTokens;
    runTotals.set(runId, running);

    const emitter = config.configurable.emitter as EventEmitter | undefined;
    emitter?.emit(
      'data',
      JSON.stringify({
        type: 'context_grew',
        kind,
        tokens: persistedTokens,
        totalEstimated: running,
      }),
    );
  } catch (err) {
    console.warn(`[persistToolContext] failed for kind=${kind}:`, err);
  }
}
