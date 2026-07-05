/**
 * Subagent Executor
 *
 * Wraps SimplifiedAgent execution with subagent-specific configuration
 * including tool restrictions, model selection, and event isolation.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage } from '@langchain/core/messages';
import { EventEmitter } from 'events';
import { Document } from '@langchain/core/documents';
import { SubagentExecution } from '@/lib/state/chatAgentState';
import { SimplifiedAgent } from '@/lib/search/simplifiedAgent';
import { SubagentDefinition } from './definitions';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { allAgentTools } from '@/lib/tools/agents';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import {
  emitStreamEvent,
  onStreamEvent,
  isAgentControlEvent,
} from '@/lib/streaming/events';

/**
 * SubagentExecutor runs a SimplifiedAgent with subagent-specific constraints
 */
export class SubagentExecutor {
  private definition: SubagentDefinition;
  private chatLlm: BaseChatModel;
  private systemLlm: BaseChatModel;
  private embeddings: CachedEmbeddings;
  private parentEmitter: EventEmitter;
  private signal: AbortSignal;
  private messageId: string;
  private retrievalSignal?: AbortSignal;
  private userLocation?: string;
  private userProfile?: string;

  constructor(
    definition: SubagentDefinition,
    chatLlm: BaseChatModel,
    systemLlm: BaseChatModel,
    embeddings: CachedEmbeddings,
    parentEmitter: EventEmitter,
    signal: AbortSignal,
    messageId: string,
    retrievalSignal?: AbortSignal,
    userLocation?: string,
    userProfile?: string,
  ) {
    this.definition = definition;
    this.chatLlm = chatLlm;
    this.systemLlm = systemLlm;
    this.embeddings = embeddings;
    this.parentEmitter = parentEmitter;
    this.signal = signal;
    this.messageId = messageId;
    this.retrievalSignal = retrievalSignal;
    this.userLocation = userLocation;
    this.userProfile = userProfile;
  }

  /**
   * Execute the subagent with a specific task
   */
  async execute(
    task: string,
    context: BaseMessage[],
    fileIds: string[],
  ): Promise<SubagentExecution> {
    const executionId = `subagent_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const startTime = Date.now();

    console.log(`SubagentExecutor: Starting ${this.definition.name}`, {
      executionId,
      task,
      allowedTools: this.definition.allowedTools,
    });

    // Emit start event to parent
    emitStreamEvent(this.parentEmitter, {
      type: 'subagent_started',
      executionId,
      name: this.definition.name,
      task,
    });

    // Track token usage across try/catch boundary
    let capturedTokenUsage:
      | {
          usageChat: {
            input_tokens: number;
            output_tokens: number;
            total_tokens: number;
          };
          usageSystem: {
            input_tokens: number;
            output_tokens: number;
            total_tokens: number;
          };
        }
      | undefined;

    try {
      // Create isolated emitter to capture subagent events
      const isolatedEmitter = this.createIsolatedEmitter(executionId);

      // Collect documents, response text, and token usage from isolated emitter
      const collectedData = {
        documents: [] as Document[],
        responseText: '',
      };

      // Listen for the subagent's own events on the isolated emitter: collect
      // its response text + documents and capture its token-usage stats.
      onStreamEvent(isolatedEmitter, (event) => {
        if (event.type === 'response') {
          collectedData.responseText += event.data || '';
        } else if (event.type === 'sources_added' || event.type === 'sources') {
          if (Array.isArray(event.data)) {
            collectedData.documents.push(...event.data);
          }
        } else if (event.type === 'model_stats' && event.data) {
          capturedTokenUsage = {
            usageChat: event.data.usageChat || {
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
            },
            usageSystem: event.data.usageSystem || {
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
            },
          };
        }
      });

      // Select the appropriate model based on subagent configuration
      const selectedLlm = this.definition.useSystemModel
        ? this.systemLlm
        : this.chatLlm;

      // Create SimplifiedAgent with subagent configuration
      // Note: personaInstructions is empty — the subagent's behavior is controlled
      // entirely by the customSystemPrompt passed to searchAndAnswer, not persona instructions.
      const subagent = new SimplifiedAgent(
        selectedLlm, // Use configured model
        this.systemLlm, // Always use system model for internal operations
        this.embeddings,
        isolatedEmitter,
        '', // No persona instructions for subagents — definition.systemPrompt is used as customSystemPrompt
        this.signal,
        `${this.messageId}_${executionId}`,
        this.retrievalSignal || this.signal, // Use retrievalSignal if available, fallback to signal
        this.userLocation,
        this.userProfile,
      );

      // Limit context to avoid token bloat
      const limitedContext = context.slice(-5);

      // Filter tools based on subagent's allowed tools
      const filteredTools = this.getFilteredTools();

      // Execute the subagent with custom tools and system prompt
      // Note: searchAndAnswer returns void and streams via emitter
      await subagent.searchAndAnswer(
        task,
        limitedContext,
        fileIds,
        'webSearch', // Focus mode (tools are already filtered)
        filteredTools,
        this.definition.systemPrompt,
      );

      // Wait a bit for all events to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      const endTime = Date.now();

      const execution: SubagentExecution = {
        id: executionId,
        name: this.definition.name,
        task,
        status: 'success',
        startTime,
        endTime,
        documents: collectedData.documents,
        summary: removeThinkingBlocks(collectedData.responseText).trim(),
        tokenUsage: capturedTokenUsage,
      };

      console.log(
        `SubagentExecutor: Completed ${this.definition.name} in ${endTime - startTime}ms`,
      );

      emitStreamEvent(this.parentEmitter, {
        type: 'subagent_completed',
        ...execution,
      });
      return execution;
    } catch (error: unknown) {
      console.error(
        `SubagentExecutor: Error in ${this.definition.name}:`,
        error,
      );

      const endTime = Date.now();

      const execution: SubagentExecution = {
        id: executionId,
        name: this.definition.name,
        task,
        status: 'error',
        startTime,
        endTime,
        documents: [],
        summary: '',
        error:
          (error instanceof Error ? error.message : null) || 'Unknown error',
        tokenUsage: capturedTokenUsage,
      };

      emitStreamEvent(this.parentEmitter, {
        type: 'subagent_error',
        ...execution,
      });
      return execution;
    }
  }

  /**
   * Filter available tools based on subagent's allowed tools list
   */
  private getFilteredTools(): typeof allAgentTools {
    // Get all available tools
    const availableTools = [...allAgentTools];

    // Filter by allowed tools whitelist
    if (this.definition.allowedTools.length > 0) {
      return availableTools.filter((tool) =>
        this.definition.allowedTools.includes(tool.name),
      );
    }

    // If no allowed tools specified, return all tools
    return availableTools;
  }

  /**
   * Create an isolated event emitter that forwards events to parent with subagent context
   */
  private createIsolatedEmitter(executionId: string): EventEmitter {
    const isolated = new EventEmitter();

    // Forward the child's wire-bound events to the parent, wrapped in a
    // subagent_data envelope. Control events (stats/end/error/interrupt/usage)
    // are the child's own lifecycle signals and are not forwarded.
    onStreamEvent(isolated, (event) => {
      if (isAgentControlEvent(event)) return;
      emitStreamEvent(this.parentEmitter, {
        type: 'subagent_data',
        subagentId: executionId,
        subagentName: this.definition.name,
        data: event,
      });
    });

    return isolated;
  }
}
