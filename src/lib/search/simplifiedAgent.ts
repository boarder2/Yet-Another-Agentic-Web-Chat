import { buildChatPrompt } from '@/lib/prompts/simplifiedAgent/chat';
import { buildFirefoxAIPrompt } from '@/lib/prompts/simplifiedAgent/firefoxAI';
import { buildLocalResearchPrompt } from '@/lib/prompts/simplifiedAgent/localResearch';
import { buildWebSearchPrompt } from '@/lib/prompts/simplifiedAgent/webSearch';
import { buildArtifactRoster } from '@/lib/prompts/simplifiedAgent/artifactGuidance';
import { listChatRoster } from '@/lib/artifacts/roster';
import { formattingAndCitationsWeb } from '@/lib/prompts/templates';
import { SimplifiedAgentState } from '@/lib/state/chatAgentState';
import {
  allAgentTools,
  fileSearchTools,
  memoryTools,
  getAllAgentTools,
  getWebSearchTools,
  getCoreTools,
  getLocalResearchTools,
  getMappingTools,
  MAPPING_TOOL_NAMES,
  isCodeExecutionEnabled,
  yaawcDocsTool,
} from '@/lib/tools/agents';
import { ARTIFACT_TOOL_NAMES } from '@/lib/tools/agents/artifactTools';
// import {
//   getLangfuseCallbacks,
//   getLangfuseHandler,
// } from '@/lib/tracing/langfuse';
import { getLanggraphCheckpointer } from '@/lib/runs/checkpointer';
import { isSoftStop } from '@/lib/utils/runControl';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { buildMultimodalHumanMessage } from '@/lib/utils/images';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { createAgent } from 'langchain';
import { EventEmitter } from 'events';
import { Document } from '@langchain/core/documents';
import { webSearchResponsePrompt } from '../prompts/templates';
import { formatDateForLLM } from '../utils';
import { prepHistoryMessages } from '../utils/contentUtils';
import { CachedEmbeddings } from '../utils/cachedEmbeddings';
import { buildPersonalizationSection } from '../utils/personalization';
import { emitStreamEvent } from '@/lib/streaming/events';
import { resolveSkillsForChat } from '@/lib/skills/resolve';
import {
  buildInvokedSkillsContext,
  buildSkillsPromptSection,
} from '@/lib/skills/promptSection';
import { setRunContext, cleanupSkillsForRun } from '@/lib/skills/runStore';
import type { Skill } from '@/lib/skills/types';
import { capabilityDocsGuidance } from '@/lib/prompts/simplifiedAgent/capabilityDocsGuidance';
import { getImageGenerationConfig } from '@/lib/settings/server';
import { getResolvedSearchCapabilities } from '@/lib/search/providers';
import type { CapabilityRuntimeFacts } from '@/lib/capabilities/availability';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import type { MappingConfiguration } from '@/lib/maps/config';
import type { MappingService } from '@/lib/maps/service';
import {
  mappingConfigurationFingerprint,
  resolveFreshMappingService,
} from '@/lib/maps/runtime';
import { toolContextSchema } from '@/lib/tools/toolContext';
import type { AgentRunConfig } from '@/lib/search/agentRunConfig';
import { ChartMentionTracker } from '@/lib/chart/handleMentions';
import {
  AgentStreamDriver,
  AgentStreamExecutionError,
  AgentStreamIntegrityError,
  extractAgentStreamTextContent,
} from '@/lib/search/agentStreamDriver';
import type { TokenTracker, Recorder } from '@/lib/tokens/tracker';

/**
 * SimplifiedAgent class that provides a streamlined interface for creating and managing an AI agent
 * with customizable focus modes and tools.
 */
export interface AgentDependencies {
  chatLlm: BaseChatModel;
  systemLlm: BaseChatModel;
  embeddings: CachedEmbeddings;
  emitter: EventEmitter;
  tokenTracking: {
    tracker: TokenTracker;
    chatRecorder: Recorder;
    systemRecorder: Recorder;
  };
}

export interface AgentRuntimeContext {
  signal: AbortSignal;
  retrievalSignal?: AbortSignal;
  threadId?: string;
  memorySection?: string;
  invokedSkillNames?: Iterable<string>;
  chartRegistry?: TurnChartRegistry;
  mapRegistry?: TurnMapRegistry;
  mappingConfig?: MappingConfiguration | null;
  mappingService?: MappingService | null;
  mappingServiceResolver?: () => MappingService | null;
  mappingSavedLocationEnabled?: boolean;
  /** Opaque current-location token; exact coordinates stay in the token store. */
  locationToken?: string;
  /** Approval that minted the token; prevents cross-approval token reuse. */
  locationApprovalId?: string;
  clientSessionId?: string;
}

export interface SearchAndAnswerCommand {
  query: string;
  history?: BaseMessage[];
  customTools?: typeof allAgentTools;
  customSystemPrompt?: string;
  messageImageIds?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraTools?: any[];
  initialDocuments?: Document[];
}

export interface ResumeCommand {
  resumeArg: unknown;
  pinnedMcpDescriptors?: import('@/lib/mcp/types').McpToolDescriptor[];
  mcpMarkupIds?: Record<string, string>;
  existingDocuments?: Document[];
}

export class SimplifiedAgent {
  private chatLlm: BaseChatModel;
  private systemLlm: BaseChatModel;
  private embeddings: CachedEmbeddings;
  private emitter: EventEmitter;
  private personaInstructions: string;
  private methodologyInstructions: string;
  private signal: AbortSignal;
  private messageId?: string;
  private retrievalSignal?: AbortSignal;
  private userLocation?: string;
  private userProfile?: string;
  private memoryEnabled: boolean;
  private memorySection: string;
  private chatId?: string;
  private workspaceId?: string | null;
  private interactiveSession: boolean;
  private resolvedSkills: Skill[] = [];
  private invokedSkillNames: Set<string> = new Set();
  private isPrivate: boolean;
  private tracker: TokenTracker;
  private chatRecorder: Recorder;
  private systemRecorder: Recorder;
  private workspaceSuffix: string;
  private aiMessageId?: string;
  private readonly chartRegistry: TurnChartRegistry;
  private readonly mapRegistry: TurnMapRegistry;
  private readonly mappingConfig: MappingConfiguration | null;
  private readonly mappingService: MappingService | null;
  private readonly mappingServiceResolver: () => MappingService | null;
  private readonly mappingSavedLocationEnabled: boolean;
  private readonly locationToken?: string;
  private readonly locationApprovalId?: string;
  private readonly clientSessionId?: string;
  /** Scans the streamed answer for placements the model narrated. */
  private readonly chartMentions = new ChartMentionTracker();
  private threadId?: string;
  private readonly runConfig: AgentRunConfig;

  constructor(options: {
    dependencies: AgentDependencies;
    run: AgentRunConfig;
    context: AgentRuntimeContext;
  }) {
    const { dependencies, run, context } = options;
    this.runConfig = run;
    this.chatLlm = dependencies.chatLlm;
    this.systemLlm = dependencies.systemLlm;
    this.embeddings = dependencies.embeddings;
    this.emitter = dependencies.emitter;
    this.personaInstructions = run.personaInstructions;
    this.methodologyInstructions = run.methodologyInstructions;
    this.signal = context.signal;
    this.messageId = run.messageId ?? undefined;
    this.retrievalSignal = context.retrievalSignal;
    this.userLocation = run.userLocation ?? undefined;
    this.userProfile = run.userProfile ?? undefined;
    this.memoryEnabled = run.memoryEnabled;
    this.memorySection = context.memorySection ?? '';
    this.chatId = run.chatId ?? undefined;
    this.interactiveSession = run.interactiveSession;
    this.isPrivate = run.isPrivate;
    this.tracker = dependencies.tokenTracking.tracker;
    this.chatRecorder = dependencies.tokenTracking.chatRecorder;
    this.systemRecorder = dependencies.tokenTracking.systemRecorder;
    this.workspaceSuffix = run.workspaceSuffix;
    this.workspaceId = run.workspaceId;
    this.aiMessageId = run.aiMessageId ?? undefined;
    this.threadId = context.threadId;
    this.invokedSkillNames = new Set(context.invokedSkillNames ?? []);
    this.chartRegistry = context.chartRegistry ?? new TurnChartRegistry();
    this.mapRegistry = context.mapRegistry ?? new TurnMapRegistry();
    this.mappingConfig = context.mappingConfig ?? null;
    this.mappingService = context.mappingService ?? null;
    this.mappingSavedLocationEnabled =
      context.mappingSavedLocationEnabled ??
      run.mappingSavedLocationEnabled === true;
    this.locationToken = context.locationToken;
    this.locationApprovalId = context.locationApprovalId;
    this.clientSessionId = context.clientSessionId;
    this.mappingServiceResolver =
      context.mappingServiceResolver ??
      (context.mappingService
        ? () => context.mappingService ?? null
        : () =>
            resolveFreshMappingService(
              this.runConfig.mappingAvailable === true,
              this.runConfig.mappingConfigHash ??
                (this.mappingConfig
                  ? mappingConfigurationFingerprint(this.mappingConfig)
                  : undefined),
            ));
  }

  /** Whether this instance may expose the top-level mapping tool set. */
  private mappingToolsEnabled(focusMode: string): boolean {
    return (
      focusMode === 'webSearch' &&
      this.interactiveSession &&
      this.runConfig.panel === null &&
      this.runConfig.mappingAvailable === true
    );
  }

  /** Build only the local, non-sensitive facts the capability tool may report. */
  private getCapabilityFacts(
    focusMode: string,
    fileIds: string[],
  ): CapabilityRuntimeFacts {
    let searchCapabilities:
      CapabilityRuntimeFacts['searchCapabilities'] | undefined;
    try {
      searchCapabilities = getResolvedSearchCapabilities(this.isPrivate);
    } catch {
      // Settings/provider resolution is local state, but a degraded DB should
      // produce an unknown status rather than breaking an otherwise valid run.
      searchCapabilities = undefined;
    }

    let imageGenerationConfigured: boolean | undefined;
    let imageGenerationEnabled: boolean | undefined;
    let codeExecutionEnabled: boolean | undefined;
    try {
      codeExecutionEnabled = isCodeExecutionEnabled();
    } catch {
      codeExecutionEnabled = undefined;
    }
    try {
      const imageConfig = getImageGenerationConfig();
      imageGenerationConfigured = Boolean(imageConfig?.model);
      imageGenerationEnabled = Boolean(
        imageConfig?.enabled && imageConfig.model,
      );
    } catch {
      imageGenerationConfigured = undefined;
      imageGenerationEnabled = undefined;
    }

    return {
      focusMode,
      isPrivate: this.isPrivate,
      hasFiles: fileIds.length > 0,
      hasWorkspace: Boolean(this.workspaceId),
      memoryEnabled: this.memoryEnabled,
      interactiveSession: this.interactiveSession,
      hasDurableChat: Boolean(this.chatId && this.aiMessageId),
      hasPersonalization: Boolean(this.userLocation || this.userProfile),
      // getCodeExecutionConfig() validates the local Docker image/host before
      // this helper is reached; no image, host, or credential value is exposed.
      codeExecutionConfigured:
        codeExecutionEnabled === undefined ? undefined : true,
      codeExecutionEnabled,
      imageGenerationConfigured,
      imageGenerationEnabled,
      searchCapabilities,
    };
  }

  private emitResponse(text: string) {
    emitStreamEvent(this.emitter, { type: 'response', data: text });
    this.placeMentionedCharts(text);
  }

  /**
   * Honor a placement the model narrated (`{chart_1}`) instead of calling
   * `show_chart`. The mention text itself is stripped downstream by every
   * writer, so this is the only chance to still render the chart it named —
   * and it must be placed as the mention streams in so the widget lands where
   * the model meant it to. A chart already shown is skipped, so a model that
   * both calls the tool and narrates the call does not place it twice.
   */
  private placeMentionedCharts(text: string) {
    for (const handle of this.chartMentions.push(text)) {
      if (this.chartRegistry.isPlaced(handle)) continue;
      try {
        const placement = this.chartRegistry.place(handle);
        emitStreamEvent(this.emitter, {
          type: 'chart_placement',
          data: {
            placementId: placement.placementId,
            chartId: placement.chartId,
            handle: placement.handle,
            placementNumber: placement.placementNumber,
          },
        });
      } catch {
        // An unknown handle or an exhausted placement budget: the mention is
        // removed from the answer either way, so there is nothing to report.
      }
    }
  }

  private createStreamDriver(
    runId: string,
    focusMode: string,
    fileIds: string[],
  ): AgentStreamDriver {
    return new AgentStreamDriver({
      llm: this.chatLlm,
      systemLlm: this.systemLlm,
      embeddings: this.embeddings,
      fileIds,
      emitter: this.emitter,
      messageId: this.messageId,
      assistantMessageId: this.aiMessageId,
      runId,
      retrievalSignal: this.retrievalSignal,
      userLocation: this.userLocation,
      userProfile: this.userProfile,
      chatId: this.chatId,
      workspaceId: this.workspaceId,
      interactiveSession: this.interactiveSession,
      isPrivate: this.isPrivate,
      tracker: this.tracker,
      chatRecorder: this.chatRecorder,
      systemRecorder: this.systemRecorder,
      chartRegistry: this.chartRegistry,
      mapRegistry: this.mapRegistry,
      mappingConfig: this.mappingConfig,
      mappingService: this.mappingService,
      mappingServiceResolver: this.mappingServiceResolver,
      mappingSavedLocationEnabled: this.mappingSavedLocationEnabled,
      locationToken: this.locationToken,
      locationApprovalId: this.locationApprovalId,
      clientSessionId: this.clientSessionId,
      capabilityFacts: () => this.getCapabilityFacts(focusMode, fileIds),
      signal: this.signal,
      threadId: this.threadId,
      resolvedSkills: this.resolvedSkills,
      onResponse: (text) => this.emitResponse(text),
    });
  }

  /**
   * Initialize the createAgent with tools and configuration
   */
  private async initializeAgent(
    focusMode: string,
    fileIds: string[] = [],
    messagesCount?: number,
    query?: string,
    firefoxAIDetected?: boolean,
    customTools?: typeof allAgentTools,
    customSystemPrompt?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraTools?: any[],
  ) {
    // Resolve skills for this chat (workspace-scoped)
    try {
      this.resolvedSkills = await resolveSkillsForChat(this.workspaceId);
    } catch (err) {
      console.warn(
        '[skills] Failed to resolve skills, continuing without:',
        err,
      );
      this.resolvedSkills = [];
    }

    // Firefox page-selection turns keep external and action tools disabled, but
    // must retain the local docs lookup so YAAWC claims remain grounded. Custom
    // deep-research prompts keep their explicit tool whitelist unchanged.
    const firefoxDocsOnly = Boolean(firefoxAIDetected && !customSystemPrompt);
    const tools = firefoxDocsOnly
      ? [yaawcDocsTool]
      : customTools
        ? customTools
        : this.getToolsForFocusMode(focusMode, fileIds);

    const allTools =
      firefoxDocsOnly || !extraTools ? tools : [...tools, ...extraTools];
    const mappingAllowed =
      !customTools &&
      !customSystemPrompt &&
      this.mappingToolsEnabled(focusMode) &&
      !firefoxAIDetected;
    const gatedTools = mappingAllowed
      ? allTools
      : allTools.filter((tool) => !MAPPING_TOOL_NAMES.includes(tool.name));

    const enhancedSystemPrompt = customSystemPrompt
      ? customSystemPrompt
      : this.createEnhancedSystemPrompt(
          focusMode,
          fileIds,
          messagesCount,
          query,
          firefoxAIDetected,
          mappingAllowed,
        );

    try {
      // Attach the LangGraph checkpointer only for top-level interactive runs
      // (those that set a thread_id). Non-interactive contexts — scheduled tasks
      // and subagents — gate out every interrupting tool, so a checkpointer there
      // only writes checkpoints that are never resumed nor cleaned up.
      const agent = createAgent({
        model: this.chatLlm,
        tools: gatedTools,
        stateSchema: SimplifiedAgentState,
        contextSchema: toolContextSchema,
        systemPrompt: enhancedSystemPrompt,
        checkpointer:
          this.interactiveSession && this.threadId
            ? getLanggraphCheckpointer()
            : undefined,
      });

      console.log(
        `SimplifiedAgent: Initialized with ${gatedTools.length} tools for focus mode: ${focusMode}`,
      );
      if (firefoxAIDetected) {
        console.log(
          'SimplifiedAgent: Firefox AI prompt detected, external/action tools will be disabled; capability docs lookup remains available.',
        );
      }
      console.log(
        `SimplifiedAgent: Tools available: ${gatedTools.map((t) => t.name).join(', ')}`,
      );
      if (fileIds.length > 0) {
        console.log(
          `SimplifiedAgent: ${fileIds.length} files available for search`,
        );
      }

      return agent;
    } catch (error) {
      console.error('SimplifiedAgent: Error initializing agent:', error);
      throw error;
    }
  }

  /**
   * Get tools based on focus mode
   */
  private getToolsForFocusMode(focusMode: string, fileIds: string[] = []) {
    let tools;
    switch (focusMode) {
      case 'chat':
        // Chat mode: Only core tools for conversational interaction
        tools = [...getCoreTools()];
        break;
      case 'webSearch':
        // Web search mode: ALL available tools for comprehensive research
        // Include file search tools if files are available
        if (fileIds.length > 0) {
          tools = [...getWebSearchTools(), ...fileSearchTools];
        } else {
          tools = [...getAllAgentTools()];
        }
        break;
      case 'localResearch':
        // Local research mode: File search tools + core tools + chart
        tools = [...getLocalResearchTools(), ...fileSearchTools];
        break;
      default:
        // Default to web search mode for unknown focus modes
        console.warn(
          `SimplifiedAgent: Unknown focus mode "${focusMode}", defaulting to webSearch tools`,
        );
        if (fileIds.length > 0) {
          tools = [...getWebSearchTools(), ...fileSearchTools];
        } else {
          tools = [...getAllAgentTools()];
        }
        break;
    }

    // Mapping tools are deliberately outside every static tool array. They are
    // available only to an ordinary interactive Web Search turn.
    if (this.mappingToolsEnabled(focusMode)) {
      tools = [...tools, ...getMappingTools()];
    }

    // Add memory tools when memory is enabled
    if (this.memoryEnabled) {
      tools = [...tools, ...memoryTools];
    }

    // Artifacts are durable DB rows, which a private chat must never leave
    // behind — so the tools are withheld rather than failing at call time.
    if (this.isPrivate) {
      tools = tools.filter((t) => !ARTIFACT_TOOL_NAMES.includes(t.name));
    }

    return tools;
  }

  private createEnhancedSystemPrompt(
    focusMode: string,
    fileIds: string[] = [],
    messagesCount?: number,
    query?: string,
    firefoxAIDetected?: boolean,
    mappingEnabled: boolean = this.mappingToolsEnabled(focusMode),
  ): string {
    const personaInstructions = this.personaInstructions || '';
    const personalizationSection = buildPersonalizationSection({
      location: this.userLocation,
      profile: this.userProfile,
    });

    let basePrompt: string;
    const codeExecutionEnabled = isCodeExecutionEnabled();
    // Tracks the modes that receive the artifact tools, so the roster below is
    // appended only where the agent can actually act on it.
    let artifactsEnabled = false;

    if (firefoxAIDetected) {
      basePrompt = buildFirefoxAIPrompt(
        personaInstructions,
        personalizationSection,
        new Date(),
      );
    } else {
      // Create focus-mode-specific prompts
      switch (focusMode) {
        case 'chat':
          basePrompt = buildChatPrompt(
            personaInstructions,
            personalizationSection,
            new Date(),
            codeExecutionEnabled,
          );
          break;
        case 'webSearch':
          artifactsEnabled = !this.isPrivate;
          basePrompt = buildWebSearchPrompt(
            personaInstructions,
            personalizationSection,
            fileIds,
            messagesCount ?? 0,
            query,
            new Date(),
            this.methodologyInstructions,
            codeExecutionEnabled,
            artifactsEnabled,
            mappingEnabled,
          );
          break;
        case 'localResearch':
          artifactsEnabled = !this.isPrivate;
          basePrompt = buildLocalResearchPrompt(
            personaInstructions,
            personalizationSection,
            new Date(),
            this.methodologyInstructions,
            codeExecutionEnabled,
            artifactsEnabled,
          );
          break;
        default:
          console.warn(
            `SimplifiedAgent: Unknown focus mode "${focusMode}", using webSearch prompt`,
          );
          artifactsEnabled = !this.isPrivate;
          basePrompt = buildWebSearchPrompt(
            personaInstructions,
            personalizationSection,
            fileIds,
            messagesCount ?? 0,
            query,
            new Date(),
            this.methodologyInstructions,
            codeExecutionEnabled,
            artifactsEnabled,
            mappingEnabled,
          );
          break;
      }
    }

    // Append memory section if available
    if (this.memorySection) {
      basePrompt += '\n\n' + this.memorySection;
    }

    // Append memory tool instructions when memory is enabled
    if (this.memoryEnabled) {
      basePrompt += `\n\n## Memory Tools
- Use \`save_memory\` ONLY when the user explicitly asks you to remember something (e.g., "remember that...", "save this...").
- Use \`delete_memory\` ONLY when the user explicitly asks you to forget something (e.g., "forget that...", "delete the memory about...").
- Use \`list_memories\` ONLY when the user explicitly asks what you remember (e.g., "what do you remember?", "list my memories").
- NEVER invoke memory tools without explicit user intent.
- Always confirm success or failure after memory operations.`;
    }

    // Append workspace context if present
    if (this.workspaceSuffix) {
      basePrompt += this.workspaceSuffix;
    }

    // The ids in tool results age out of context; this keeps the documents the
    // chat created or the user mentioned addressable in later turns.
    if (artifactsEnabled && this.chatId) {
      basePrompt += buildArtifactRoster(
        listChatRoster({
          chatId: this.chatId,
          workspaceId: this.workspaceId ?? null,
        }),
        new Date(),
      );
    }

    // Append skills section if skills are available. Exclude slash-only skills
    // and skills already invoked by the user — their bodies are injected into
    // history, so re-listing them in the prompt would be redundant.
    const modelVisibleSkills = this.resolvedSkills.filter(
      (s) => !s.disableModelInvocation && !this.invokedSkillNames.has(s.name),
    );
    if (modelVisibleSkills.length > 0) {
      basePrompt += '\n\n' + buildSkillsPromptSection(modelVisibleSkills);
    }

    // This is deliberately the final prompt layer so persona, memory, workspace,
    // and skill instructions cannot weaken product-claim grounding. Firefox AI
    // keeps external/action tools disabled, but can use the local docs lookup.
    basePrompt += '\n\n' + capabilityDocsGuidance;

    return basePrompt;
  }

  /**
   * Execute the simplified agent workflow
   */
  async searchAndAnswer(command: SearchAndAnswerCommand): Promise<void> {
    const {
      query,
      history = [],
      customTools,
      customSystemPrompt,
      messageImageIds,
      extraTools,
      initialDocuments,
    } = command;
    const { focusMode, fileIds } = this.runConfig;
    let skillRunId: string | null = null;

    try {
      console.log(`SimplifiedAgent: Starting search for query: "${query}"`);
      console.log(`SimplifiedAgent: Focus mode: ${focusMode}`);
      console.log(`SimplifiedAgent: File IDs: ${fileIds.join(', ')}`);

      setTimeout(() => {
        this.emitResponse('');
      }, 100);

      const trimmed = query.trim();
      const startsWithAscii = trimmed.startsWith("I'm on page");
      const startsWithCurly = trimmed.startsWith('I’' + 'm on page');
      const containsSelection = trimmed.includes('<selection>');
      const firefoxAIDetected =
        (startsWithAscii || startsWithCurly) && containsSelection;
      const preparedHistory = prepHistoryMessages(history);

      const agent = await this.initializeAgent(
        focusMode,
        fileIds,
        preparedHistory.length + 1,
        query,
        firefoxAIDetected,
        customTools,
        customSystemPrompt,
        extraTools,
      );
      const invokedSkillsContext = buildInvokedSkillsContext(
        this.resolvedSkills,
        this.invokedSkillNames,
      );
      const humanContent = invokedSkillsContext
        ? `${invokedSkillsContext}\n\n${query}`
        : query;
      const humanMsg =
        messageImageIds && messageImageIds.length > 0
          ? buildMultimodalHumanMessage(humanContent, messageImageIds)
          : new HumanMessage(humanContent);
      const messagesHistory = [...preparedHistory, humanMsg];
      const seededDocuments = initialDocuments ?? [];
      const initialState = {
        messages: messagesHistory,
        query,
        focusMode,
        fileIds,
        relevantDocuments: seededDocuments,
        subagentExecutions: [],
      };

      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      skillRunId = runId;
      setRunContext(runId, {
        chatId: this.chatId ?? '',
        parentMessageId: this.aiMessageId ?? '',
        skills: this.resolvedSkills,
      });

      const driver = this.createStreamDriver(runId, focusMode, fileIds);
      const config = driver.buildConfig();
      const eventStream = agent.streamEvents(initialState, {
        ...config,
        version: 'v2',
        callbacks: driver.callbacks({
          kind: 'start',
          seededDocuments,
          firefoxAIDetected,
        }),
      });

      let streamResult;
      try {
        streamResult = await driver.consume(
          eventStream,
          { kind: 'start', seededDocuments, firefoxAIDetected },
          agent,
        );
      } catch (error) {
        if (error instanceof AgentStreamIntegrityError) throw error;
        if (this.retrievalSignal?.aborted && isSoftStop(this.messageId || '')) {
          streamResult =
            error instanceof AgentStreamExecutionError
              ? error.result
              : {
                  finalResult: null,
                  collectedDocuments: [],
                  responseText: '',
                  interrupted: false,
                  aborted: false,
                };
          const docsString = streamResult.collectedDocuments
            .map((doc, idx) => {
              const meta = doc?.metadata || {};
              const title = meta.title || meta.url || `Source ${idx + 1}`;
              const url = meta.url || '';
              const snippet = doc?.pageContent || '';
              return `<${idx + 1}>
<title>${title}</title>
${url ? `<url>${url}</url>` : ''}
<content>\n${snippet}\n</content>
</${idx + 1}>`;
            })
            .join('\n\n');

          let respondNowPrompt: ChatPromptTemplate;
          if (customSystemPrompt) {
            const synthesisSystemPrompt = `${customSystemPrompt}\n\n## Early Synthesis\nYou were interrupted before completing your full research. Synthesize a response from the documents gathered so far.\n\n<context>\n${
              docsString || 'No context documents available.'
            }\n</context>\n\nCurrent date: ${formatDateForLLM(new Date())}`;
            respondNowPrompt = ChatPromptTemplate.fromMessages([
              ['system', synthesisSystemPrompt],
              ['user', query],
            ]);
          } else {
            respondNowPrompt = await ChatPromptTemplate.fromMessages([
              ['system', webSearchResponsePrompt],
              ['user', query],
            ]).partial({
              formattingAndCitations: this.personaInstructions
                ? this.personaInstructions
                : formattingAndCitationsWeb.content,
              personalizationDirectives: buildPersonalizationSection({
                location: this.userLocation,
                profile: this.userProfile,
              }),
              context: docsString || 'No context documents available.',
              date: formatDateForLLM(new Date()),
            });
          }

          const chain = RunnableSequence.from([
            respondNowPrompt,
            this.chatLlm,
          ]).withConfig({
            runName: 'SimplifiedRespondNowSynthesis',
            signal: this.signal,
          });
          const eventStream2 = chain.streamEvents({ query }, { version: 'v2' });

          this.emitResponse(
            `## ⚠︎ Early response triggered by budget or user request. ⚠︎\nResponse may be incomplete, lack citations, or omit important content.\n\n---\n\n`,
          );
          const synthesisResult = await driver.consume(eventStream2, {
            kind: 'respond-now',
            existingDocuments: streamResult.collectedDocuments,
            emitFinalSources: true,
          });
          streamResult = {
            ...streamResult,
            finalResult:
              streamResult.finalResult ?? synthesisResult.finalResult,
            responseText:
              streamResult.responseText + synthesisResult.responseText,
          };
        } else {
          throw error;
        }
      }

      if (streamResult.interrupted) {
        if (skillRunId) cleanupSkillsForRun(skillRunId);
        return;
      }

      const currentResponseBuffer = streamResult.responseText;
      const finalResult = streamResult.finalResult;
      if (
        currentResponseBuffer === '' &&
        finalResult?.messages &&
        finalResult.messages.length > 0
      ) {
        const finalMessage =
          finalResult.messages[finalResult.messages.length - 1];
        if (finalMessage?.content) {
          console.log('SimplifiedAgent: Emitting complete response (fallback)');
          const text = extractAgentStreamTextContent(finalMessage.content);
          if (text) this.emitResponse(text);
        }
      }

      if (
        currentResponseBuffer === '' &&
        (!finalResult ||
          !finalResult.messages ||
          finalResult.messages.length === 0)
      ) {
        console.warn('SimplifiedAgent: No valid response found');
        this.emitResponse(
          'I apologize, but I was unable to generate a complete response to your query. Please try rephrasing your question or providing more specific details.',
        );
      }

      console.log('SimplifiedAgent: Usage collected:', this.tracker.statsV2());
      if (skillRunId) cleanupSkillsForRun(skillRunId);
      emitStreamEvent(this.emitter, { type: 'agent_end' });
    } catch (error: unknown) {
      if (skillRunId) cleanupSkillsForRun(skillRunId);

      if (error instanceof AgentStreamIntegrityError) {
        console.error('SimplifiedAgent: Stream integrity failure:', error);
        emitStreamEvent(this.emitter, {
          type: 'agent_error',
          data: error.message,
        });
        return;
      }

      console.error('SimplifiedAgent: Error during search and answer:', error);
      if (this.signal.aborted) {
        console.warn('SimplifiedAgent: Operation was aborted');
        this.emitResponse('The search operation was cancelled.');
      } else {
        this.emitResponse(
          'I encountered an error while processing your request. Please try rephrasing your query or contact support if the issue persists.',
        );
      }
      emitStreamEvent(this.emitter, { type: 'agent_end' });
    }
  }

  /**
   * Resume a paused run from a LangGraph checkpoint.
   * Called by the resume endpoint after an interrupt is answered.
   */
  async doResume(command: ResumeCommand): Promise<void> {
    const {
      resumeArg,
      pinnedMcpDescriptors = [],
      mcpMarkupIds = {},
      existingDocuments = [],
    } = command;
    const { focusMode, fileIds } = this.runConfig;
    let skillRunId: string | null = null;

    try {
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      skillRunId = runId;
      setRunContext(runId, {
        chatId: this.chatId ?? '',
        parentMessageId: this.aiMessageId ?? '',
        skills: this.resolvedSkills,
      });

      // Reconstruct workspace tools so a resumed approval has the same tool
      // surface as the original interactive run.
      const resumeExtraTools: unknown[] = [];
      if (this.workspaceId) {
        const [
          { workspaceLsTool },
          { workspaceGrepTool },
          { workspaceReadTool },
          { workspaceEditTool },
          { workspaceCreateFileTool },
        ] = await Promise.all([
          import('@/lib/tools/workspace/ls'),
          import('@/lib/tools/workspace/grep'),
          import('@/lib/tools/workspace/read'),
          import('@/lib/tools/workspace/edit'),
          import('@/lib/tools/workspace/create'),
        ]);
        resumeExtraTools.push(
          workspaceLsTool(),
          workspaceGrepTool(),
          workspaceReadTool({ visionCapable: false }),
          workspaceEditTool(),
          workspaceCreateFileTool(),
        );
      }

      const { buildMcpLangchainTools, buildToolForDescriptor } =
        await import('@/lib/mcp/toolFactory');
      const builtNames = new Set<string>();
      try {
        const mcpTools = await buildMcpLangchainTools({
          workspaceId: this.workspaceId,
        });
        resumeExtraTools.push(...mcpTools);
        for (const tool of mcpTools) builtNames.add(tool.name);
      } catch (error) {
        console.warn(
          '[SimplifiedAgent] doResume: failed to rebuild live MCP tools:',
          error,
        );
      }
      for (const descriptor of pinnedMcpDescriptors) {
        if (!builtNames.has(descriptor.namespacedName)) {
          resumeExtraTools.push(buildToolForDescriptor(descriptor));
        }
      }

      const agent = await this.initializeAgent(
        focusMode,
        fileIds,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        resumeExtraTools.length > 0 ? resumeExtraTools : undefined,
      );
      const driver = this.createStreamDriver(runId, focusMode, fileIds);
      const config = driver.buildConfig();
      const resumePolicy = await driver.prepareResumePolicy(
        agent,
        mcpMarkupIds,
        existingDocuments,
      );
      const { Command } = await import('@langchain/langgraph');
      const eventStream = agent.streamEvents(
        new Command({ resume: resumeArg }),
        {
          ...config,
          version: 'v2',
          callbacks: driver.callbacks(resumePolicy),
        },
      );
      const streamResult = await driver.consume(
        eventStream,
        resumePolicy,
        agent,
      );

      if (streamResult.interrupted) {
        if (skillRunId) cleanupSkillsForRun(skillRunId);
        return;
      }

      if (skillRunId) cleanupSkillsForRun(skillRunId);
      emitStreamEvent(this.emitter, { type: 'agent_end' });
    } catch (error: unknown) {
      if (skillRunId) cleanupSkillsForRun(skillRunId);
      // A location resume carries a bearer token in process-local state. Do
      // not stringify that engine error into logs or the wire if it includes
      // the resume payload.
      const safeError = this.locationToken
        ? 'The approved location could not be used; ask for a named origin instead.'
        : error instanceof AgentStreamIntegrityError
          ? error.message
          : String(error);
      if (this.locationToken) {
        console.error(
          '[SimplifiedAgent] doResume failed for location approval',
        );
      } else {
        console.error('[SimplifiedAgent] doResume error:', error);
      }
      emitStreamEvent(this.emitter, {
        type: 'agent_error',
        data: safeError,
      });
    }
  }

  /**
   * Get current configuration info
   */
  getInfo(): object {
    return {
      personaInstructions: !!this.personaInstructions,
    };
  }
}
