import { z } from 'zod';
import type { EventEmitter } from 'events';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import type { TokenTracker, Recorder } from '@/lib/tokens/tracker';
import type { CapabilityRuntimeFacts } from '@/lib/capabilities/availability';
import type { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import type { MappingConfiguration } from '@/lib/maps/config';
import type { MappingService } from '@/lib/maps/service';
import type { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';

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
  /** LangGraph checkpoint thread binding for transient location tokens. */
  threadId: z.string().optional(),
  isPrivate: z.boolean(),
  llm: z.custom<BaseChatModel>(),
  runId: z.string(),
  userLocation: z.string().optional(),
  userProfile: z.string().optional(),
  tracker: z.custom<TokenTracker>(),
  chatRecorder: z.custom<Recorder>(),
  systemRecorder: z.custom<Recorder>(),
  /** Current turn's short-handle → private chart registry. */
  chartRegistry: z.custom<TurnChartRegistry>(),
  /** Current turn's provider-grounded map/places/routes registry. */
  mapRegistry: z.custom<TurnMapRegistry>(),
  /** Initial mapping snapshot; endpoint details never reach the model. */
  mappingConfig: z.custom<MappingConfiguration>().nullable().optional(),
  /** Initial provider facade, retained only for the lifetime of this run. */
  mappingService: z.custom<MappingService>().nullable().optional(),
  /** Re-resolves settings immediately before each mapping provider call. */
  mappingServiceResolver: z.custom<() => MappingService | null>().optional(),
  /** Consent snapshot used by the later explicit-location flow. */
  mappingSavedLocationEnabled: z.boolean().optional(),
  /** Opaque current-location token; coordinates remain in the token store. */
  locationToken: z.string().min(32).max(200).optional(),
  /** Approval that minted the token; prevents cross-approval token reuse. */
  locationApprovalId: z.string().min(1).max(200).optional(),
  /** Page session used to scope precise live map overlays. */
  clientSessionId: z.string().min(1).max(200).optional(),
  /**
   * Non-sensitive local facts used only for safe capability availability.
   * Deferred: resolving these hits settings/provider storage, and only the rare
   * status branch of `search_yaawc_docs` ever reads them.
   */
  capabilityFacts: z.custom<() => CapabilityRuntimeFacts>().optional(),
});

export type ToolContext = z.infer<typeof toolContextSchema>;
