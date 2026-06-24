/**
 * Panel Coordinator
 *
 * Runs the same user prompt across 2–4 executor models concurrently. Each
 * executor is a full SimplifiedAgent restricted to non-prompting research tools
 * (no code execution, workspace edits, ask_user, edit_skill, or deep_research)
 * and runs against an isolated EventEmitter so its stream can be forwarded to
 * the parent as `panel_executor_*` events without polluting the parent's own
 * tool/token streams. Executors receive chat history, retrieved memory, and the
 * active persona / methodology so each model researches in the user's configured
 * voice; the orchestrator then synthesizes their results in that same voice.
 *
 * After all executors settle, their sources are merged + deduped by URL into a
 * single citation set (with 1-based `sourceId`s) for the orchestrator.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage } from '@langchain/core/messages';
import { Document } from '@langchain/core/documents';
import { EventEmitter } from 'events';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { getModelName } from '@/lib/utils/modelUtils';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import {
  getAllAgentTools,
  getWebSearchTools,
  getLocalResearchTools,
  fileSearchTools,
} from '@/lib/tools/agents';
import { filterExecutorTools } from '@/lib/tools/panel/restrictedToolset';
import type { ModelRef } from '@/lib/types/panel';

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type PanelUsage = {
  usageChat: TokenUsage;
  usageSystem: TokenUsage;
};

export interface PanelExecutorResult {
  idx: number;
  model: ModelRef;
  modelName: string;
  status: 'success' | 'error';
  text: string;
  sources: Document[];
  usage?: PanelUsage;
  error?: string;
}

export interface PanelCoordinatorResult {
  executorResults: PanelExecutorResult[];
  mergedSources: Document[];
  totalUsage: PanelUsage;
}

export interface ResolvedExecutor {
  ref: ModelRef;
  llm: BaseChatModel;
}

/** Max executors run at once. The panel caps executors at 4, so all run together. */
export const PANEL_CONCURRENCY = 4;

/** Build the (read-only) research toolset for an executor in a given focus mode. */
function executorToolsForFocusMode(focusMode: string, fileIds: string[]) {
  let tools;
  switch (focusMode) {
    case 'localResearch':
      tools = [...getLocalResearchTools(), ...fileSearchTools];
      break;
    case 'webSearch':
    default:
      tools =
        fileIds.length > 0
          ? [...getWebSearchTools(), ...fileSearchTools]
          : [...getAllAgentTools()];
      break;
  }
  return filterExecutorTools(tools);
}

export class PanelCoordinator {
  private executors: ResolvedExecutor[];
  private systemLlm: BaseChatModel;
  private embeddings: CachedEmbeddings;
  private parentEmitter: EventEmitter;
  private signal: AbortSignal;
  private messageId: string;
  private retrievalSignal?: AbortSignal;
  private userLocation?: string;
  private userProfile?: string;
  private memorySection: string;
  private personaInstructions: string;
  private methodologyInstructions: string;

  constructor(params: {
    executors: ResolvedExecutor[];
    systemLlm: BaseChatModel;
    embeddings: CachedEmbeddings;
    parentEmitter: EventEmitter;
    signal: AbortSignal;
    messageId: string;
    retrievalSignal?: AbortSignal;
    userLocation?: string;
    userProfile?: string;
    memorySection?: string;
    personaInstructions?: string;
    methodologyInstructions?: string;
  }) {
    this.executors = params.executors;
    this.systemLlm = params.systemLlm;
    this.embeddings = params.embeddings;
    this.parentEmitter = params.parentEmitter;
    this.signal = params.signal;
    this.messageId = params.messageId;
    this.retrievalSignal = params.retrievalSignal;
    this.userLocation = params.userLocation;
    this.userProfile = params.userProfile;
    this.memorySection = params.memorySection ?? '';
    this.personaInstructions = params.personaInstructions ?? '';
    this.methodologyInstructions = params.methodologyInstructions ?? '';
  }

  /** Run all executors concurrently and merge their sources. */
  async run(
    query: string,
    history: BaseMessage[],
    fileIds: string[],
    focusMode: string,
    messageImageIds?: string[],
  ): Promise<PanelCoordinatorResult> {
    const results = await Promise.allSettled(
      this.executors.map((ex, idx) =>
        this.runOne(
          ex,
          idx,
          query,
          history,
          fileIds,
          focusMode,
          messageImageIds,
        ),
      ),
    );

    const executorResults: PanelExecutorResult[] = results.map((r, idx) => {
      if (r.status === 'fulfilled') return r.value;
      // runOne never throws (it catches internally), but guard regardless.
      const ref = this.executors[idx].ref;
      return {
        idx,
        model: ref,
        modelName: ref.name,
        status: 'error' as const,
        text: '',
        sources: [],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });

    const succeeded = executorResults.filter((e) => e.status === 'success');
    if (succeeded.length === 0) {
      throw new Error('All panel executors failed; no answers to synthesize.');
    }

    const mergedSources = this.mergeSources(executorResults);

    const totalUsage: PanelUsage = {
      usageChat: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      usageSystem: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
    for (const e of executorResults) {
      if (!e.usage) continue;
      for (const k of [
        'input_tokens',
        'output_tokens',
        'total_tokens',
      ] as const) {
        totalUsage.usageChat[k] += e.usage.usageChat[k];
        totalUsage.usageSystem[k] += e.usage.usageSystem[k];
      }
    }

    return { executorResults, mergedSources, totalUsage };
  }

  private async runOne(
    executor: ResolvedExecutor,
    idx: number,
    query: string,
    history: BaseMessage[],
    fileIds: string[],
    focusMode: string,
    messageImageIds?: string[],
  ): Promise<PanelExecutorResult> {
    const modelName = getModelName(executor.llm) || executor.ref.name;

    this.emit('panel_executor_started', { executorIdx: idx, model: modelName });

    const isolated = new EventEmitter();
    const collected = { text: '', documents: [] as Document[] };
    let usage: PanelUsage | undefined;

    isolated.on('data', (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'response') {
          const token = parsed.data || '';
          collected.text += token;
          if (token) {
            this.emit('panel_executor_data', { executorIdx: idx, token });
          }
        } else if (parsed.type === 'sources_added') {
          // Incremental per-search batches: accumulate.
          if (Array.isArray(parsed.data))
            collected.documents.push(...parsed.data);
        } else if (parsed.type === 'sources') {
          // The final `sources` event re-emits the agent's COMPLETE document
          // set (the same docs already streamed via `sources_added`), so treat
          // it as authoritative and replace — appending here would double-count
          // every source (inflating sourceCount and duplicating URL-less docs).
          if (Array.isArray(parsed.data)) collected.documents = parsed.data;
        }
      } catch {
        // ignore malformed event
      }
    });

    isolated.on('stats', (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'modelStats' && parsed.data) {
          usage = {
            usageChat: parsed.data.usageChat || {
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
            },
            usageSystem: parsed.data.usageSystem || {
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
            },
          };
        }
      } catch {
        // ignore malformed stats
      }
    });

    try {
      const agent = new SimplifiedAgent(
        executor.llm,
        this.systemLlm,
        this.embeddings,
        isolated,
        this.personaInstructions, // executors research in the user's configured voice
        this.signal,
        `${this.messageId}_panel_${idx}`,
        this.retrievalSignal ?? this.signal,
        this.userLocation,
        this.userProfile,
        false, // memory tools off for executors
        this.memorySection, // but inject retrieved memory context
        undefined, // chatId
        false, // interactiveSession
        this.methodologyInstructions,
      );

      const tools = executorToolsForFocusMode(focusMode, fileIds);

      await agent.searchAndAnswer(
        query,
        history,
        fileIds,
        focusMode,
        tools,
        undefined,
        messageImageIds,
      );

      // `searchAndAnswer` emits all of its events (response tokens, the final
      // `sources` set, model stats, then `end`) synchronously before it
      // resolves, and the isolated listeners above are synchronous, so by this
      // point `collected` is fully populated — no flush delay is needed.
      const text = removeThinkingBlocks(collected.text).trim();
      this.emit('panel_executor_completed', {
        executorIdx: idx,
        model: modelName,
        sourceCount: collected.documents.length,
        usage,
      });

      return {
        idx,
        model: executor.ref,
        modelName,
        status: 'success',
        text,
        sources: collected.documents,
        usage,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit('panel_executor_error', {
        executorIdx: idx,
        model: modelName,
        error,
      });
      return {
        idx,
        model: executor.ref,
        modelName,
        status: 'error',
        text: '',
        sources: [],
        usage,
        error,
      };
    }
  }

  /**
   * Merge + dedupe executor sources by URL into a single ordered set with
   * 1-based `sourceId`s for the orchestrator's citation indexing.
   */
  private mergeSources(results: PanelExecutorResult[]): Document[] {
    const seen = new Set<string>();
    const merged: Document[] = [];
    for (const r of results) {
      for (const doc of r.sources) {
        const url = (doc.metadata?.url || doc.metadata?.source || '') as string;
        if (url && seen.has(url)) continue;
        if (url) seen.add(url);
        merged.push(
          new Document({
            pageContent: doc.pageContent,
            metadata: { ...doc.metadata, sourceId: merged.length + 1 },
          }),
        );
      }
    }
    return merged;
  }

  private emit(type: string, data: Record<string, unknown>): void {
    this.parentEmitter.emit('data', JSON.stringify({ type, ...data }));
  }
}
