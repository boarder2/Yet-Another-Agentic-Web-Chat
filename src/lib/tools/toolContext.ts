import { z } from 'zod';
import type { EventEmitter } from 'events';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';

/**
 * Per-run context handed to every tool via LangChain's native `ToolRuntime`
 * (see `defineTool.ts`). Mirrors what `SimplifiedAgent` previously stuffed into
 * `RunnableConfig.configurable` — same fields, now typed and validated instead
 * of hand-parsed per tool. `thread_id` stays LangGraph-owned in `configurable`,
 * not here.
 */
export const toolContextSchema = z.object({
  emitter: z.custom<EventEmitter>(),
  retrievalSignal: z.custom<AbortSignal>().optional(),
  messageId: z.string().optional(),
  systemLlm: z.custom<BaseChatModel>(),
  workspaceId: z.string().nullable().optional(),
  embeddings: z.custom<CachedEmbeddings>(),
  interactiveSession: z.boolean(),
  fileIds: z.array(z.string()),
  chatId: z.string().optional(),
  isPrivate: z.boolean(),
  llm: z.custom<BaseChatModel>(),
  runId: z.string(),
  userLocation: z.string().optional(),
  userProfile: z.string().optional(),
});

export type ToolContext = z.infer<typeof toolContextSchema>;
