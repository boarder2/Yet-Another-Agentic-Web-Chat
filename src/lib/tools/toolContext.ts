import { z } from 'zod';
import type { EventEmitter } from 'events';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import type { TokenTracker, Recorder } from '@/lib/tokens/tracker';

export const capabilityRuntimeFactsSchema = z.object({
  focusMode: z.string().optional(),
  isPrivate: z.boolean().optional(),
  hasFiles: z.boolean().optional(),
  hasWorkspace: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  interactiveSession: z.boolean().optional(),
  hasDurableChat: z.boolean().optional(),
  hasPersonalization: z.boolean().optional(),
  codeExecutionConfigured: z.boolean().optional(),
  codeExecutionEnabled: z.boolean().optional(),
  imageGenerationConfigured: z.boolean().optional(),
  imageGenerationEnabled: z.boolean().optional(),
  searchCapabilities: z
    .object({
      web: z.boolean().optional(),
      images: z.boolean().optional(),
      videos: z.boolean().optional(),
      autocomplete: z.boolean().optional(),
    })
    .optional(),
});

export type CapabilityRuntimeFacts = z.infer<
  typeof capabilityRuntimeFactsSchema
>;

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
  /** The assistant row this turn is writing into; what durable rows anchor to. */
  assistantMessageId: z.string().optional(),
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
  tracker: z.custom<TokenTracker>(),
  chatRecorder: z.custom<Recorder>(),
  systemRecorder: z.custom<Recorder>(),
  /** Non-sensitive local facts used only for safe capability availability. */
  capabilityFacts: capabilityRuntimeFactsSchema.optional(),
});

export type ToolContext = z.infer<typeof toolContextSchema>;
