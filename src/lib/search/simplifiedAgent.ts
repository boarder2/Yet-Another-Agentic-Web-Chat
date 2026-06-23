import { buildChatPrompt } from '@/lib/prompts/simplifiedAgent/chat';
import { buildFirefoxAIPrompt } from '@/lib/prompts/simplifiedAgent/firefoxAI';
import { buildLocalResearchPrompt } from '@/lib/prompts/simplifiedAgent/localResearch';
import { buildWebSearchPrompt } from '@/lib/prompts/simplifiedAgent/webSearch';
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
  isCodeExecutionEnabled,
} from '@/lib/tools/agents';
// import {
//   getLangfuseCallbacks,
//   getLangfuseHandler,
// } from '@/lib/tracing/langfuse';
import { encodeHtmlAttribute, encodeBase64 } from '@/lib/utils/html';
import {
  pushCallbackRunId,
  dropCallbackRunId as dropCodeCallbackRunId,
} from '@/lib/sandbox/codeExecutionCorrelation';
import {
  pushCallbackRunId as pushQuestionCallbackRunId,
  dropCallbackRunId as dropQuestionCallbackRunId,
} from '@/lib/userQuestion/questionCorrelation';
import { getLanggraphCheckpointer } from '@/lib/runs/checkpointer';
import { isGraphInterrupt } from '@langchain/langgraph';
import { isSoftStop } from '@/lib/utils/runControl';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { buildMultimodalHumanMessage } from '@/lib/utils/images';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableConfig, RunnableSequence } from '@langchain/core/runnables';
import { createAgent } from 'langchain';
import { EventEmitter } from 'events';
import { Document } from '@langchain/core/documents';
import { webSearchResponsePrompt } from '../prompts/templates';
import { formatDateForLLM } from '../utils';
import { prepHistoryMessages } from '../utils/contentUtils';
import { getModelName } from '../utils/modelUtils';
import { CachedEmbeddings } from '../utils/cachedEmbeddings';
import { buildPersonalizationSection } from '../utils/personalization';
import { TokenUsage } from '../utils/queryDistillation';
import { resolveSkillsForChat } from '@/lib/skills/resolve';
import { buildSkillsPromptSection } from '@/lib/skills/promptSection';
import { setRunContext, cleanupSkillsForRun } from '@/lib/skills/runStore';
import type { Skill } from '@/lib/skills/types';

/**
 * Normalize usage metadata from different LLM providers
 */
function normalizeUsageMetadata(usageData: Record<string, number>): {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
} {
  if (!usageData) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  // Handle different provider formats
  const inputTokens =
    usageData.input_tokens ||
    usageData.prompt_tokens ||
    usageData.promptTokens ||
    usageData.usedTokens ||
    0;

  const outputTokens =
    usageData.output_tokens ||
    usageData.completion_tokens ||
    usageData.completionTokens ||
    0;

  const totalTokens =
    usageData.total_tokens ||
    usageData.totalTokens ||
    usageData.usedTokens ||
    inputTokens + outputTokens;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

/**
 * Extract text content from LLM message content (handles both string and array formats)
 * OpenAI returns string, Anthropic returns array of content blocks.
 * Thinking/reasoning blocks are wrapped in <think> tags so the frontend ThinkBox renders them.
 */
function extractTextContent(
  content:
    | string
    | Array<{
        type?: string;
        text?: string;
        thinking?: string;
        reasoning?: string;
      }>
    | null
    | undefined,
): string {
  if (!content) return '';

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    let text = '';
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;

      if (
        (block.type === 'text' || block.type === 'text_delta') &&
        block.text
      ) {
        // Regular text output
        text += block.text;
      } else if (
        (block.type === 'thinking' || block.type === 'thinking_delta') &&
        block.thinking
      ) {
        // Anthropic extended thinking blocks — wrap so ThinkBox renders them
        text += `<think>${block.thinking}</think>`;
      } else if (block.type === 'reasoning' && block.reasoning) {
        // LangChain normalized reasoning block — wrap so ThinkBox renders them
        text += `<think>${block.reasoning}</think>`;
      }
    }
    return text;
  }

  return '';
}

/**
 * SimplifiedAgent class that provides a streamlined interface for creating and managing an AI agent
 * with customizable focus modes and tools.
 */
export class SimplifiedAgent {
  private chatLlm: BaseChatModel;
  private systemLlm: BaseChatModel;
  private embeddings: CachedEmbeddings;
  private emitter: EventEmitter;
  private personaInstructions: string;
  private methodologyInstructions: string;
  private signal: AbortSignal;
  private currentToolNames: string[] = [];
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
  private initialSystemUsage: TokenUsage;
  private workspaceSuffix: string;
  private firstChatCallInputTokens = 0;
  private aiMessageId?: string;
  private threadId?: string;
  private chatModelRef?: {
    provider: string;
    name: string;
    contextWindowSize?: number;
  };
  private systemModelRef?: {
    provider: string;
    name: string;
    contextWindowSize?: number;
  } | null;
  private panelConfig: Record<string, unknown> | null = null;

  constructor(
    chatLlm: BaseChatModel,
    systemLlm: BaseChatModel,
    embeddings: CachedEmbeddings,
    emitter: EventEmitter,
    personaInstructions: string = '',
    signal: AbortSignal,
    messageId?: string,
    retrievalSignal?: AbortSignal,
    userLocation?: string,
    userProfile?: string,
    memoryEnabled: boolean = false,
    memorySection: string = '',
    chatId?: string,
    interactiveSession: boolean = false,
    methodologyInstructions: string = '',
    isPrivate: boolean = false,
    initialSystemUsage?: TokenUsage,
    workspaceSuffix: string = '',
    workspaceId?: string | null,
    aiMessageId?: string,
  ) {
    this.chatLlm = chatLlm;
    this.systemLlm = systemLlm;
    this.embeddings = embeddings;
    this.emitter = emitter;
    this.personaInstructions = personaInstructions;
    this.methodologyInstructions = methodologyInstructions;
    this.signal = signal;
    this.messageId = messageId;
    this.retrievalSignal = retrievalSignal;
    this.userLocation = userLocation;
    this.userProfile = userProfile;
    this.memoryEnabled = memoryEnabled;
    this.memorySection = memorySection;
    this.chatId = chatId;
    this.interactiveSession = interactiveSession;
    this.isPrivate = isPrivate;
    this.initialSystemUsage = initialSystemUsage ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
    this.workspaceSuffix = workspaceSuffix;
    this.workspaceId = workspaceId;
    this.aiMessageId = aiMessageId;
  }

  public setInvokedSkillNames(names: Set<string> | Iterable<string>) {
    this.invokedSkillNames = new Set(names);
  }

  public setThreadId(threadId: string) {
    this.threadId = threadId;
  }

  /** Add to the pre-seeded system-token usage (e.g. panel executor totals) so
   *  the run's reported system tokens include work done before this agent ran. */
  public addInitialSystemUsage(usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }) {
    this.initialSystemUsage = {
      input_tokens: this.initialSystemUsage.input_tokens + usage.input_tokens,
      output_tokens:
        this.initialSystemUsage.output_tokens + usage.output_tokens,
      total_tokens: this.initialSystemUsage.total_tokens + usage.total_tokens,
    };
  }

  /** Stash the panel config so it lands in the resume config snapshot. */
  public setPanelConfig(panel: Record<string, unknown> | null) {
    this.panelConfig = panel;
  }

  public setModelRefs(
    chatModelRef: {
      provider: string;
      name: string;
      contextWindowSize?: number;
    },
    systemModelRef?: {
      provider: string;
      name: string;
      contextWindowSize?: number;
    } | null,
  ) {
    this.chatModelRef = chatModelRef;
    this.systemModelRef = systemModelRef;
  }

  /** Returns serializable config state for DB persistence (for resume after restart). */
  public buildConfigSnapshot(
    focusMode: string,
    fileIds: string[],
  ): Record<string, unknown> {
    return {
      chatModelRef: this.chatModelRef,
      systemModelRef: this.systemModelRef,
      focusMode,
      fileIds,
      personaInstructions: this.personaInstructions,
      methodologyInstructions: this.methodologyInstructions,
      userLocation: this.userLocation,
      userProfile: this.userProfile,
      workspaceId: this.workspaceId,
      isPrivate: this.isPrivate,
      chatId: this.chatId,
      messageId: this.messageId,
      aiMessageId: this.aiMessageId,
      interactiveSession: this.interactiveSession,
      workspaceSuffix: this.workspaceSuffix,
      memoryEnabled: this.memoryEnabled,
      panel: this.panelConfig,
    };
  }

  private emitResponse(text: string) {
    this.emitter.emit('data', JSON.stringify({ type: 'response', data: text }));
  }

  /**
   * Emit model usage statistics to the client
   */
  private emitModelStats(
    usageChat: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    },
    usageSystem: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    },
    usageImageGen?: {
      modelName: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    },
  ) {
    const imageGenTokens = usageImageGen?.total_tokens ?? 0;
    this.emitter.emit(
      'stats',
      JSON.stringify({
        type: 'modelStats',
        data: {
          modelName: getModelName(this.chatLlm),
          modelNameChat: getModelName(this.chatLlm),
          modelNameSystem: getModelName(this.systemLlm),
          usage: {
            input_tokens:
              usageChat.input_tokens +
              usageSystem.input_tokens +
              (usageImageGen?.input_tokens ?? 0),
            output_tokens:
              usageChat.output_tokens +
              usageSystem.output_tokens +
              (usageImageGen?.output_tokens ?? 0),
            total_tokens:
              usageChat.total_tokens +
              usageSystem.total_tokens +
              imageGenTokens,
          },
          usageChat,
          usageSystem,
          usageImageGen: usageImageGen
            ? {
                modelName: usageImageGen.modelName,
                input_tokens: usageImageGen.input_tokens,
                output_tokens: usageImageGen.output_tokens,
                total_tokens: usageImageGen.total_tokens,
              }
            : undefined,
          firstChatCallInputTokens: this.firstChatCallInputTokens,
        },
      }),
    );
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

    const tools = customTools
      ? customTools
      : firefoxAIDetected
        ? []
        : this.getToolsForFocusMode(focusMode, fileIds);

    const allTools = extraTools ? [...tools, ...extraTools] : tools;

    // Cache tool names for usage attribution heuristics
    this.currentToolNames = allTools.map((t) => t.name.toLowerCase());

    const enhancedSystemPrompt = customSystemPrompt
      ? customSystemPrompt
      : this.createEnhancedSystemPrompt(
          focusMode,
          fileIds,
          messagesCount,
          query,
          firefoxAIDetected,
        );

    try {
      // Attach the LangGraph checkpointer only for top-level interactive runs
      // (those that set a thread_id). Non-interactive contexts — scheduled tasks
      // and subagents — gate out every interrupting tool, so a checkpointer there
      // only writes checkpoints that are never resumed nor cleaned up.
      const agent = createAgent({
        model: this.chatLlm,
        tools: allTools,
        stateSchema: SimplifiedAgentState,
        systemPrompt: enhancedSystemPrompt,
        checkpointer:
          this.interactiveSession && this.threadId
            ? getLanggraphCheckpointer()
            : undefined,
      });

      console.log(
        `SimplifiedAgent: Initialized with ${allTools.length} tools for focus mode: ${focusMode}`,
      );
      if (firefoxAIDetected) {
        console.log(
          'SimplifiedAgent: Firefox AI prompt detected, tools will be disabled for this turn.',
        );
      }
      console.log(
        `SimplifiedAgent: Tools available: ${allTools.map((t) => t.name).join(', ')}`,
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

    // Add memory tools when memory is enabled
    if (this.memoryEnabled) {
      tools = [...tools, ...memoryTools];
    }

    return tools;
  }

  private createEnhancedSystemPrompt(
    focusMode: string,
    fileIds: string[] = [],
    messagesCount?: number,
    query?: string,
    firefoxAIDetected?: boolean,
  ): string {
    const personaInstructions = this.personaInstructions || '';
    const personalizationSection = buildPersonalizationSection({
      location: this.userLocation,
      profile: this.userProfile,
    });

    let basePrompt: string;
    const codeExecutionEnabled = isCodeExecutionEnabled();

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
          );
          break;
        case 'webSearch':
          basePrompt = buildWebSearchPrompt(
            personaInstructions,
            personalizationSection,
            fileIds,
            messagesCount ?? 0,
            query,
            new Date(),
            this.methodologyInstructions,
            codeExecutionEnabled,
          );
          break;
        case 'localResearch':
          basePrompt = buildLocalResearchPrompt(
            personaInstructions,
            personalizationSection,
            new Date(),
            this.methodologyInstructions,
            codeExecutionEnabled,
          );
          break;
        default:
          console.warn(
            `SimplifiedAgent: Unknown focus mode "${focusMode}", using webSearch prompt`,
          );
          basePrompt = buildWebSearchPrompt(
            personaInstructions,
            personalizationSection,
            fileIds,
            messagesCount ?? 0,
            query,
            new Date(),
            this.methodologyInstructions,
            codeExecutionEnabled,
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

    // Append skills section if skills are available. Exclude slash-only skills
    // and skills already invoked by the user — their bodies are injected into
    // history, so re-listing them in the prompt would be redundant.
    const modelVisibleSkills = this.resolvedSkills.filter(
      (s) => !s.disableModelInvocation && !this.invokedSkillNames.has(s.name),
    );
    if (modelVisibleSkills.length > 0) {
      basePrompt += '\n\n' + buildSkillsPromptSection(modelVisibleSkills);
    }

    return basePrompt;
  }

  /**
   * Execute the simplified agent workflow
   */
  async searchAndAnswer(
    query: string,
    history: BaseMessage[] = [],
    fileIds: string[] = [],
    focusMode: string = 'webSearch',
    customTools?: typeof allAgentTools,
    customSystemPrompt?: string,
    messageImageIds?: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraTools?: any[],
    initialDocuments?: Document[],
  ): Promise<void> {
    // Declared outside try so the catch block can clean it up
    let toolLlmUsageHandler: ((data: string) => void) | null = null;
    let skillRunId: string | null = null;

    try {
      console.log(`SimplifiedAgent: Starting search for query: "${query}"`);
      console.log(`SimplifiedAgent: Focus mode: ${focusMode}`);
      console.log(`SimplifiedAgent: File IDs: ${fileIds.join(', ')}`);

      // Write this on a background thread after a delay otherwise the emitter won't be listening
      setTimeout(() => {
        this.emitResponse(''); // Empty response, to give the UI a message to display.
      }, 100);

      const humanMsg =
        messageImageIds && messageImageIds.length > 0
          ? buildMultimodalHumanMessage(query, messageImageIds)
          : new HumanMessage(query);

      // Detect Firefox AI prompt pattern
      const trimmed = query.trim();
      const startsWithAscii = trimmed.startsWith("I'm on page");
      const startsWithCurly = trimmed.startsWith('I’' + 'm on page'); // handle curly apostrophe variant
      const containsSelection = trimmed.includes('<selection>');
      const firefoxAIDetected =
        (startsWithAscii || startsWithCurly) && containsSelection;
      const toolCalls: Record<string, string> = {};

      const messagesHistory = [
        // new SystemMessage(
        //   this.createEnhancedSystemPrompt(
        //     focusMode,
        //     fileIds,
        //     history.length,
        //     query,
        //     firefoxAIDetected,
        //   ),
        // ),
        ...prepHistoryMessages(history),
        humanMsg,
      ];

      // Run-ID attribution sets (see AGENTS.md — Run-ID Attribution section)
      // LangChain's AsyncLocalStorage propagates the parent's callback context into child
      // tool executions, so child SimplifiedAgent LLM events also appear in this stream.
      // These sets let us distinguish the parent agent's own events from nested child events.

      // run_id of each active deep_research tool invocation in the parent graph's tools node
      const deepResearchRunIds = new Set<string>();
      // run_id of each 'tools' node chain start that belongs to the parent graph (not a child)
      const parentToolsNodeRunIds = new Set<string>();
      // run_id of each LLM call that belongs to THIS parent agent's 'model_request' node
      const activeAgentLlmRunIds = new Set<string>();

      // Initialize agent with the provided focus mode and file context
      // Pass the number of messages that will be sent to the LLM so prompts can adapt.
      const llmMessagesCount = messagesHistory.length;
      const agent = await this.initializeAgent(
        focusMode,
        fileIds,
        llmMessagesCount,
        query,
        firefoxAIDetected,
        customTools,
        customSystemPrompt,
        extraTools,
      );

      // Prepare initial state. `initialDocuments` (panel orchestrator) seeds the
      // citation set so the agent's [n] references align with the pre-merged
      // sources, and further searches append after them.
      const seededDocuments = initialDocuments ?? [];
      const initialState = {
        messages: messagesHistory,
        query,
        focusMode,
        fileIds,
        relevantDocuments: seededDocuments,
        subagentExecutions: [],
      };

      // Stash resolved skills + per-run context (chatId/parentMessageId) so
      // read_skill and other context-bearing tools can persist their reads.
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      skillRunId = runId;
      setRunContext(runId, {
        chatId: this.chatId ?? '',
        parentMessageId: this.aiMessageId ?? '',
        skills: this.resolvedSkills,
      });

      // Configure the agent run
      const config: RunnableConfig = {
        configurable: {
          thread_id: this.threadId ?? `simplified_agent_${Date.now()}`,
          llm: this.chatLlm,
          systemLlm: this.systemLlm,
          embeddings: this.embeddings,
          fileIds,
          personaInstructions: this.personaInstructions,
          focusMode,
          emitter: this.emitter,
          firefoxAIDetected,
          // Pass through message and retrieval controls for tools
          messageId: this.messageId,
          runId,
          retrievalSignal: this.retrievalSignal,
          userLocation: this.userLocation,
          userProfile: this.userProfile,
          chatId: this.chatId,
          workspaceId: this.workspaceId,
          interactiveSession: this.interactiveSession,
          isPrivate: this.isPrivate,
        },
        recursionLimit: 150, // Increased to handle complex multi-task research with todo_list
        signal: this.retrievalSignal,
        // ...getLangfuseCallbacks(),
      };

      // Use streamEvents to capture both tool calls and token-level streaming
      const eventStream = agent.streamEvents(initialState, {
        ...config,
        version: 'v2',
        callbacks: [
          {
            handleToolStart: (
              tool,
              input,
              runId,
              parentRunId?,
              tags?,
              metadata?,
              runName?,
            ) => {
              console.log('SimplifiedAgent: Tool started:', {
                tool,
                input,
                runId,
                parentRunId,
                tags,
                metadata,
                runName,
              });
              const toolName = runName || tool.name || 'unknown';
              toolCalls[runId] = toolName;

              // Skip generic tool events for tools with specialized inline rendering
              if (
                toolName === 'deep_research' ||
                toolName === 'todo_list' ||
                toolName === 'create_chart'
              ) {
                return;
              }

              // For read_skill: suppress events when loading a system skill (silent)
              if (toolName === 'read_skill') {
                try {
                  const parsedInput =
                    typeof input === 'string' ? JSON.parse(input) : input;
                  const skillName = parsedInput?.name as string | undefined;
                  if (skillName && this.resolvedSkills.length > 0) {
                    const matched = this.resolvedSkills.find(
                      (s) => s.name === skillName,
                    );
                    if (matched && matched.source === 'system') {
                      delete toolCalls[runId];
                      return;
                    }
                  }
                } catch {
                  // Fall through to emit normally
                }
              }

              // Skip tool calls from child SimplifiedAgent graphs.
              // parentRunId is the run_id of the invoking 'tools' node; if it isn't in
              // parentToolsNodeRunIds it belongs to a nested child graph, not this agent.
              if (parentRunId && !parentToolsNodeRunIds.has(parentRunId)) {
                delete toolCalls[runId];
                return;
              }

              // Emit a tool_call_started event so UI can display a running state spinner.
              try {
                const type = toolName.trim();
                // We only include lightweight identifying args for now; avoid large payloads.
                const TOOL_ARG_MAX_LENGTH = 350;
                let extraAttr = '';
                try {
                  if (input && typeof input === 'string') {
                    // Construct an object from the input json string if possible
                    const trimmed = input.trim();
                    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                      try {
                        input = JSON.parse(trimmed);
                      } catch {
                        // If parsing fails, fall back to original string
                        input = trimmed;
                      }
                    }
                  }
                  if (input && typeof input === 'object') {
                    const inputObj = input as Record<string, unknown>;
                    if (typeof inputObj.query === 'string') {
                      const q = encodeHtmlAttribute(
                        inputObj.query.slice(0, TOOL_ARG_MAX_LENGTH),
                      );
                      extraAttr += ` query="${q}"`;
                    }
                    // For read_skill, surface the skill name as query for UI display
                    if (
                      toolName === 'read_skill' &&
                      typeof inputObj.name === 'string'
                    ) {
                      const n = encodeHtmlAttribute(
                        inputObj.name.slice(0, TOOL_ARG_MAX_LENGTH),
                      );
                      extraAttr += ` query="${n}"`;
                    }
                    if (Array.isArray(inputObj.urls)) {
                      const count = inputObj.urls.length;
                      extraAttr += ` count="${count}"`;
                    }
                    if (typeof inputObj.url === 'string') {
                      const u = encodeHtmlAttribute(
                        inputObj.url.slice(0, TOOL_ARG_MAX_LENGTH),
                      );
                      extraAttr += ` url="${u}"`;
                    }
                    if (typeof inputObj.pdfUrl === 'string') {
                      const u = encodeHtmlAttribute(
                        inputObj.pdfUrl.slice(0, TOOL_ARG_MAX_LENGTH),
                      );
                      extraAttr += ` url="${u}"`;
                    }
                    // Memory tools: extract content for display
                    if (
                      typeof inputObj.content === 'string' &&
                      !inputObj.query
                    ) {
                      const c = encodeHtmlAttribute(
                        inputObj.content.slice(0, TOOL_ARG_MAX_LENGTH),
                      );
                      extraAttr += ` query="${c}"`;
                    }
                  }
                  // For code_execution, include the code as a base64-encoded attribute
                  // to avoid breaking the markdown parser with long/complex content
                  if (
                    type === 'code_execution' &&
                    input &&
                    typeof input === 'object'
                  ) {
                    const inputObj = input as Record<string, unknown>;
                    if (typeof inputObj.code === 'string') {
                      const c = encodeBase64(inputObj.code);
                      extraAttr += ` code="${c}"`;
                      // Store correlation: code content → callback runId
                      // Used by codeExecutionTool to include the correct markup toolCallId
                      // in its code_execution_pending event (fixes race with async Docker checks)
                      pushCallbackRunId(inputObj.code, runId);
                    }
                    if (typeof inputObj.description === 'string') {
                      extraAttr += ` description="${encodeHtmlAttribute(inputObj.description.slice(0, 100))}"`;
                    }
                  }
                  // For ask_user, store correlation and include question as attribute
                  if (
                    type === 'ask_user' &&
                    input &&
                    typeof input === 'object'
                  ) {
                    const inputObj = input as Record<string, unknown>;
                    if (typeof inputObj.question === 'string') {
                      extraAttr += ` query="${encodeHtmlAttribute(inputObj.question.slice(0, 200))}"`;
                      // Store correlation: question text → callback runId
                      pushQuestionCallbackRunId(inputObj.question, runId);
                    }
                    if (typeof inputObj.context === 'string') {
                      extraAttr += ` context="${encodeHtmlAttribute(inputObj.context.slice(0, 200))}"`;
                    }
                  }
                  if (
                    type === 'get_message' &&
                    input &&
                    typeof input === 'object'
                  ) {
                    const inputObj = input as Record<string, unknown>;
                    if (inputObj.messageId !== undefined) {
                      extraAttr += ` query="${encodeHtmlAttribute(String(inputObj.messageId))}"`;
                    }
                  }
                  if (
                    type === 'chat_history_search' &&
                    input &&
                    typeof input === 'object'
                  ) {
                    const inputObj = input as Record<string, unknown>;
                    if (Array.isArray(inputObj.keywords)) {
                      const joined = inputObj.keywords
                        .filter((k) => typeof k === 'string')
                        .join(', ');
                      extraAttr += ` query="${encodeHtmlAttribute(joined.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    }
                  }
                  // For workspace tools, extract relevant args for display
                  if (
                    (type === 'workspace_read' ||
                      type === 'workspace_grep' ||
                      type === 'workspace_edit' ||
                      type === 'workspace_create_file') &&
                    input &&
                    typeof input === 'object'
                  ) {
                    const inputObj = input as Record<string, unknown>;
                    if (
                      type === 'workspace_read' &&
                      typeof inputObj.file === 'string'
                    ) {
                      extraAttr += ` query="${encodeHtmlAttribute(inputObj.file.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    }
                    if (
                      type === 'workspace_grep' &&
                      typeof inputObj.pattern === 'string'
                    ) {
                      extraAttr += ` query="${encodeHtmlAttribute(inputObj.pattern.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    }
                    if (
                      (type === 'workspace_edit' ||
                        type === 'workspace_create_file') &&
                      typeof inputObj.file === 'string'
                    ) {
                      extraAttr += ` query="${encodeHtmlAttribute(inputObj.file.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                      // Correlate filename → callback runId so the interrupt's
                      // *_pending event carries the chip's markupToolCallId and
                      // the chip can be closed to success on resume (markupKey =
                      // input.file in workspace edit/create tools).
                      pushQuestionCallbackRunId(inputObj.file, runId);
                    }
                  }
                  // For skill edits, correlate skill name → callback runId
                  // (markupKey = input.name in editSkillTool) so the chip closes.
                  if (
                    type === 'edit_skill' &&
                    input &&
                    typeof input === 'object'
                  ) {
                    const inputObj = input as Record<string, unknown>;
                    if (typeof inputObj.name === 'string') {
                      pushQuestionCallbackRunId(inputObj.name, runId);
                    }
                  }
                } catch (_attrErr) {
                  // Ignore attribute extraction errors
                }

                this.emitter.emit(
                  'data',
                  JSON.stringify({
                    type: 'tool_call_started',
                    data: {
                      // Provide initial markup with status running; toolCallId used for later update.
                      content: `<ToolCall type="${encodeHtmlAttribute(type)}" status="running" toolCallId="${encodeHtmlAttribute(runId)}"${extraAttr}></ToolCall>`,
                      toolCallId: runId,
                      status: 'running',
                    },
                  }),
                );
              } catch (emitErr) {
                console.warn('Failed to emit tool_call_started event', emitErr);
              }
            },
            handleToolEnd: (output, runId, parentRunId, tags) => {
              console.log('SimplifiedAgent: Tool completed:', {
                output,
                runId,
                parentRunId,
                tags,
              });

              const toolName = toolCalls[runId];

              // Skip if the tool was never registered (e.g. filtered out as a child-graph call)
              if (!toolName) return;

              // Reaching here means the tool finished without interrupting (the
              // interrupt path is the isGraphInterrupt branch in handleToolError),
              // so any correlation entry it pushed speculatively in handleToolStart
              // is stale. Drop it; otherwise a later interrupt for the same key
              // (e.g. an edit_skill create that early-errors, then an update) would
              // pop this dead runId and target the wrong markup widget.
              dropQuestionCallbackRunId(runId);
              dropCodeCallbackRunId(runId);

              // Skip generic tool events for tools with specialized inline rendering
              if (
                toolName === 'deep_research' ||
                toolName === 'todo_list' ||
                toolName === 'create_chart'
              ) {
                delete toolCalls[runId];
                return;
              }

              // For read_skill: surface structured {error} payloads as UI errors
              if (toolName === 'read_skill') {
                const outputStr =
                  typeof output === 'string'
                    ? output
                    : typeof output?.content === 'string'
                      ? output.content
                      : null;
                let errorMsg: string | null = null;
                if (outputStr) {
                  try {
                    const parsed = JSON.parse(outputStr);
                    if (parsed && typeof parsed.error === 'string') {
                      errorMsg = parsed.error;
                    }
                  } catch {
                    // Not JSON — treat as successful skill body
                  }
                }
                if (errorMsg) {
                  if (toolCalls[runId]) delete toolCalls[runId];
                  try {
                    this.emitter.emit(
                      'data',
                      JSON.stringify({
                        type: 'tool_call_error',
                        data: {
                          toolCallId: runId,
                          status: 'error',
                          error: errorMsg.substring(0, 500),
                        },
                      }),
                    );
                  } catch (emitErr) {
                    console.warn(
                      'Failed to emit tool_call_error event',
                      emitErr,
                    );
                  }
                  return;
                }
              }

              // If youtube transcript tool, capture videoId for potential future UI enhancements
              let extra: Record<string, string> | undefined;
              if (toolName === 'youtube_transcript') {
                const videoId =
                  output?.update?.relevantDocuments?.[0]?.metadata?.source;
                if (videoId) {
                  extra = { videoId: String(videoId) };
                }
              }
              // If image_generation, extract imageId from tool output for UI rendering
              if (toolName === 'image_generation') {
                try {
                  const msgContent = output?.update?.messages?.[0]?.content;
                  if (typeof msgContent === 'string') {
                    const parsed = JSON.parse(msgContent);
                    if (parsed.imageId) {
                      extra = { imageId: String(parsed.imageId) };
                    }
                  }
                } catch {
                  // If parsing fails, skip extra
                }
              }
              if (toolCalls[runId]) delete toolCalls[runId];

              // Emit success update so UI can swap spinner for checkmark
              try {
                this.emitter.emit(
                  'data',
                  JSON.stringify({
                    type: 'tool_call_success',
                    data: {
                      toolCallId: runId,
                      status: 'success',
                      ...(extra ? { extra } : {}),
                    },
                  }),
                );
              } catch (emitErr) {
                console.warn('Failed to emit tool_call_success event', emitErr);
              }
            },
            handleToolError: (err, runId, parentRunId, tags) => {
              // LangGraph interrupts propagate as errors through the callback system — they
              // are not actual tool failures. Skip the error event so the widget stays "running"
              // rather than showing the raw interrupt payload as an error message.
              if (isGraphInterrupt(err)) {
                if (toolCalls[runId]) delete toolCalls[runId];
                return;
              }

              console.error('SimplifiedAgent: Tool error:', {
                error: err,
                runId,
                parentRunId,
                tags,
              });

              const toolName = toolCalls[runId];

              // Skip if the tool was never registered (e.g. filtered out as a child-graph call)
              if (!toolName) return;

              // Reaching here means the tool finished without interrupting (the
              // interrupt path is the isGraphInterrupt branch in handleToolError),
              // so any correlation entry it pushed speculatively in handleToolStart
              // is stale. Drop it; otherwise a later interrupt for the same key
              // (e.g. an edit_skill create that early-errors, then an update) would
              // pop this dead runId and target the wrong markup widget.
              dropQuestionCallbackRunId(runId);
              dropCodeCallbackRunId(runId);

              // Skip generic tool events for tools with specialized inline rendering
              if (
                toolName === 'deep_research' ||
                toolName === 'todo_list' ||
                toolName === 'create_chart'
              ) {
                delete toolCalls[runId];
                return;
              }

              const message =
                (err && (err.message || err.toString())) ||
                'Unknown tool error';
              // Emit error update to UI
              try {
                this.emitter.emit(
                  'data',
                  JSON.stringify({
                    type: 'tool_call_error',
                    data: {
                      toolCallId: runId,
                      status: 'error',
                      error: message.substring(0, 500),
                    },
                  }),
                );
              } catch (emitErr) {
                console.warn('Failed to emit tool_call_error event', emitErr);
              }
            },
          },
          // getLangfuseHandler() || {},
        ],
      });

      let finalResult: {
        messages?: BaseMessage[];
        relevantDocuments?: Document[];
      } | null = null;
      const collectedDocuments: Document[] = [];
      let currentResponseBuffer = '';
      // Separate usage trackers for chat (final answer) and system (tools/internal chains).
      // Pre-seed usageSystem with any pre-agent LLM usage (e.g., query distillation).
      const usageChat = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      const usageImageGen: {
        modelName: string;
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
      } = { modelName: '', input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      const usageSystem = {
        input_tokens: this.initialSystemUsage.input_tokens,
        output_tokens: this.initialSystemUsage.output_tokens,
        total_tokens: this.initialSystemUsage.total_tokens,
      };

      let initialMessageSent = false;

      // Listen for token usage emitted by tools (url_fetch, deep_research)
      // that make their own LLM calls outside the agent's streamEvents chain.
      toolLlmUsageHandler = (data: string) => {
        try {
          const usage = JSON.parse(data);
          if (usage.target === 'image_gen') {
            usageImageGen.modelName = usage.modelName || 'unknown';
            usageImageGen.input_tokens += usage.input_tokens || 0;
            usageImageGen.output_tokens += usage.output_tokens || 0;
            usageImageGen.total_tokens += usage.total_tokens || 0;
          } else if (usage.target === 'chat') {
            usageChat.input_tokens += usage.input_tokens || 0;
            usageChat.output_tokens += usage.output_tokens || 0;
            usageChat.total_tokens += usage.total_tokens || 0;
          } else {
            // Default to system
            usageSystem.input_tokens += usage.input_tokens || 0;
            usageSystem.output_tokens += usage.output_tokens || 0;
            usageSystem.total_tokens += usage.total_tokens || 0;
          }
          // Emit updated stats to client
          this.emitModelStats(usageChat, usageSystem, usageImageGen);
        } catch (error) {
          console.error(
            'SimplifiedAgent: Error processing tool_llm_usage:',
            error,
          );
        }
      };
      this.emitter.on('tool_llm_usage', toolLlmUsageHandler);

      // Seed pre-merged citation set (panel orchestrator) into the collected
      // documents + emit them so the UI numbers them ahead of any new searches.
      if (seededDocuments.length > 0) {
        collectedDocuments.push(...seededDocuments);
        this.emitter.emit(
          'data',
          JSON.stringify({
            type: 'sources_added',
            data: seededDocuments,
            searchQuery: 'Panel sources',
            searchUrl: '',
          }),
        );
      }

      try {
        // Process the event stream
        for await (const event of eventStream) {
          // Check if the operation has been aborted (e.g., client disconnected)
          if (this.signal.aborted) {
            console.log(
              'SimplifiedAgent: Abort signal received, stopping event processing',
            );
            break;
          }

          if (!initialMessageSent) {
            initialMessageSent = true;
            // If Firefox AI was detected, emit synthetic lifecycle events so UI can show a completed pseudo-tool
            if (firefoxAIDetected) {
              const syntheticId = `firefoxAI-${Date.now()}`;
              try {
                // Emit single started event already marked success to avoid double UI churn
                this.emitter.emit(
                  'data',
                  JSON.stringify({
                    type: 'tool_call_started',
                    data: {
                      content: `<ToolCall type="firefoxAI" status="success" toolCallId="${syntheticId}"></ToolCall>`,
                      toolCallId: syntheticId,
                      status: 'success',
                    },
                  }),
                );
              } catch (e) {
                console.warn(
                  'Failed to emit firefoxAI synthetic tool event',
                  e,
                );
              }
            }
          }

          const emitNewDocs = (newDocs: Document[]) => {
            //Group by metadata.searchQuery and emit separate source blocks for each
            const groupedBySearchQuery = newDocs.reduce(
              (acc, doc) => {
                const searchQuery = doc.metadata?.searchQuery || 'Agent Search';
                if (!acc[searchQuery]) {
                  acc[searchQuery] = [];
                }
                acc[searchQuery].push(doc);
                return acc;
              },
              {} as Record<string, Document[]>,
            );

            for (const [searchQuery, docs] of Object.entries(
              groupedBySearchQuery,
            )) {
              this.emitter.emit(
                'data',
                JSON.stringify({
                  type: 'sources_added',
                  data: docs,
                  searchQuery,
                  searchUrl: '',
                }),
              );
            }
          };

          // --- Run-ID attribution tracking (Steps 2-4) ---
          // Step 2: Track deep_research tool execution run IDs.
          // Any on_chat_model_start / on_chain_start with a parent_id in this set
          // belongs to a child SimplifiedAgent, not the parent graph.
          if (
            event.event === 'on_tool_start' &&
            event.name === 'deep_research'
          ) {
            deepResearchRunIds.add(event.run_id);
          }
          if (
            (event.event === 'on_tool_end' ||
              event.event === 'on_tool_error') &&
            event.name === 'deep_research'
          ) {
            deepResearchRunIds.delete(event.run_id);
          }

          // Step 3: Track parent-graph 'tools' node run IDs.
          // handleToolStart callbacks receive parentRunId; we compare it against this set
          // to skip tool call lifecycle events that come from child agent tool executions.
          if (
            event.event === 'on_chain_start' &&
            event.metadata?.langgraph_node === 'tools' &&
            !(event as unknown as { parent_ids?: string[] }).parent_ids?.some(
              (id: string) => deepResearchRunIds.has(id),
            )
          ) {
            parentToolsNodeRunIds.add(event.run_id);
          }
          if (
            (event.event === 'on_chain_end' ||
              event.event === 'on_chain_error') &&
            event.metadata?.langgraph_node === 'tools'
          ) {
            parentToolsNodeRunIds.delete(event.run_id);
          }

          // Step 4: Register parent-agent LLM run IDs.
          // Drain happens later in the on_chat_model_end handler (after token counting)
          // to avoid a use-after-delete race on the same event.
          if (
            event.event === 'on_chat_model_start' &&
            event.metadata?.langgraph_node === 'model_request' &&
            !(event as unknown as { parent_ids?: string[] }).parent_ids?.some(
              (id: string) => deepResearchRunIds.has(id),
            )
          ) {
            activeAgentLlmRunIds.add(event.run_id);
          }

          // --- End attribution tracking ---

          // Handle different event types
          if (
            event.event === 'on_chain_end' &&
            event.name === 'RunnableSequence'
          ) {
            finalResult = event.data.output;
            // Collect relevant documents from the final result
            if (finalResult && finalResult.relevantDocuments) {
              collectedDocuments.push(...finalResult.relevantDocuments);
              emitNewDocs(finalResult.relevantDocuments);
            }
          }

          // Collect sources from tool results
          if (
            event.event === 'on_chain_end' &&
            (event.name.includes('search') ||
              event.name.includes('Search') ||
              event.name.includes('tool') ||
              event.name.includes('Tool'))
          ) {
            // Handle LangGraph state updates with relevantDocuments
            if (event.data?.output && Array.isArray(event.data.output)) {
              for (const item of event.data.output) {
                if (
                  item.update &&
                  item.update.relevantDocuments &&
                  Array.isArray(item.update.relevantDocuments)
                ) {
                  collectedDocuments.push(...item.update.relevantDocuments);
                  emitNewDocs(item.update.relevantDocuments);

                  // Log for deep_research to verify sources are being emitted
                  if (event.name === 'deep_research') {
                    console.log(
                      `SimplifiedAgent: deep_research returned ${item.update.relevantDocuments.length} documents`,
                    );
                  }
                }
              }
            }
          }

          // Handle streaming tool calls (for thought messages)
          // Only count events from the 'model_request' node (createAgent's LLM node).
          // In LangChain/LangGraph v1.x, AsyncLocalStorage propagates parent callbacks into
          // tool executions, so system model llm.invoke() calls inside tools also fire
          // on_chat_model_end in this stream. Those events have langgraph_node === 'tools'
          // and must be excluded — their tokens are reported via tool_llm_usage instead.
          // Additionally guard by activeAgentLlmRunIds to exclude child SimplifiedAgent
          // LLM calls (which also have langgraph_node === 'model_request' from the child's graph).
          if (
            event.event === 'on_chat_model_end' &&
            event.data.output &&
            event.metadata?.langgraph_node === 'model_request' &&
            activeAgentLlmRunIds.has(event.run_id)
          ) {
            const output = event.data.output;

            if (output.usage_metadata) {
              const normalized = normalizeUsageMetadata(output.usage_metadata);
              if (!this.firstChatCallInputTokens) {
                this.firstChatCallInputTokens = normalized.input_tokens;
              }
              usageChat.input_tokens += normalized.input_tokens;
              usageChat.output_tokens += normalized.output_tokens;
              usageChat.total_tokens += normalized.total_tokens;
              console.log(
                'SimplifiedAgent: Collected usage from usage_metadata:',
                normalized,
              );
              // Emit live snapshot
              this.emitModelStats(usageChat, usageSystem, usageImageGen);
            } else if (output.response_metadata?.usage) {
              // Fallback to response_metadata for different model providers
              const normalized = normalizeUsageMetadata(
                output.response_metadata.usage,
              );
              if (!this.firstChatCallInputTokens) {
                this.firstChatCallInputTokens = normalized.input_tokens;
              }
              usageChat.input_tokens += normalized.input_tokens;
              usageChat.output_tokens += normalized.output_tokens;
              usageChat.total_tokens += normalized.total_tokens;
              console.log(
                'SimplifiedAgent: Collected usage from response_metadata:',
                normalized,
              );
              this.emitModelStats(usageChat, usageSystem, usageImageGen);
            }
          }
          // Drain activeAgentLlmRunIds AFTER the token-counting check above so the
          // has() test doesn't evaluate against an already-deleted entry.
          if (event.event === 'on_chat_model_end') {
            activeAgentLlmRunIds.delete(event.run_id);
          }

          // Handle LLM end events for token usage tracking (completion models only; same
          // node filter as on_chat_model_end to exclude tool-level system LLM calls).
          // Also guarded by activeAgentLlmRunIds for the same child-agent reason above.
          if (
            event.event === 'on_llm_end' &&
            event.data.output &&
            event.metadata?.langgraph_node === 'model_request' &&
            activeAgentLlmRunIds.has(event.run_id)
          ) {
            const output = event.data.output;

            // Only count tokens from the agent node. System model calls inside tools
            // report via tool_llm_usage and have langgraph_node === 'tools'.
            if (output.llmOutput?.tokenUsage) {
              const normalized = normalizeUsageMetadata(
                output.llmOutput.tokenUsage,
              );
              if (!this.firstChatCallInputTokens) {
                this.firstChatCallInputTokens = normalized.input_tokens;
              }
              usageChat.input_tokens += normalized.input_tokens;
              usageChat.output_tokens += normalized.output_tokens;
              usageChat.total_tokens += normalized.total_tokens;
              console.log(
                'SimplifiedAgent: Collected usage from llmOutput:',
                normalized,
              );
              this.emitModelStats(usageChat, usageSystem, usageImageGen);
            }
          }

          // Handle token-level streaming for the final response.
          // Guard by activeAgentLlmRunIds so that tokens from child SimplifiedAgent
          // instances (spawned by deep_research) — which bubble up via AsyncLocalStorage
          // callback propagation — are not emitted as parent response tokens.
          if (
            event.event === 'on_chat_model_stream' &&
            event.data.chunk &&
            activeAgentLlmRunIds.has(event.run_id)
          ) {
            const chunk = event.data.chunk;
            const textContent = extractTextContent(chunk.content);

            if (textContent) {
              currentResponseBuffer += textContent;
              this.emitResponse(textContent);
            }
          }
        }

        // After the stream loop ends normally, check for pending LangGraph interrupts.
        // When interrupt() is called inside a tool, LangGraph pauses the graph and writes
        // a checkpoint; the stream ends cleanly but tasks[*].interrupts is populated.
        if (!this.signal.aborted && this.threadId) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const agentState = await (agent as any).getState({
              configurable: { thread_id: this.threadId },
            });
            const pendingInterrupts = (agentState?.tasks ?? []).flatMap(
              (t: { interrupts?: unknown[] }) => t.interrupts ?? [],
            );
            if (pendingInterrupts.length > 0) {
              // runHost listens for 'interrupts' and handles DB persistence + status transition
              this.emitter.emit(
                'interrupts',
                JSON.stringify(pendingInterrupts),
              );
              if (toolLlmUsageHandler) {
                this.emitter.removeListener(
                  'tool_llm_usage',
                  toolLlmUsageHandler,
                );
              }
              if (skillRunId) cleanupSkillsForRun(skillRunId);
              return; // Do NOT emit 'end' — run is now paused at an interrupt
            }
          } catch (stateErr) {
            console.warn(
              '[simplifiedAgent] interrupt state check failed:',
              stateErr,
            );
          }
        }
      } catch (err: unknown) {
        if (
          this.retrievalSignal &&
          this.retrievalSignal.aborted &&
          isSoftStop(this.messageId || '')
        ) {
          // If respond-now was triggered, run a quick synthesis from collected context before finalization

          const docsString = collectedDocuments
            .map((doc, idx: number) => {
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

          // Build the respond-now prompt based on whether a custom system prompt is active.
          // When customSystemPrompt is provided (e.g. deep research subagent), use it
          // instead of the default webSearchResponsePrompt to stay consistent with
          // the agent's original role.
          let respondNowPrompt: ChatPromptTemplate;
          if (customSystemPrompt) {
            const synthesisSystemPrompt = `${customSystemPrompt}\n\n## Early Synthesis\nYou were interrupted before completing your full research. Synthesize a response from the documents gathered so far.\n\n<context>\n${docsString || 'No context documents available.'}\n</context>\n\nCurrent date: ${formatDateForLLM(new Date())}`;
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
            // ...getLangfuseCallbacks(),
            signal: this.signal,
          });

          const eventStream2 = chain.streamEvents(
            { query },
            { version: 'v2' /* ...getLangfuseCallbacks() */ },
          );

          this.emitResponse(
            `## ⚠︎ Early response triggered by budget or user request. ⚠︎\nResponse may be incomplete, lack citations, or omit important content.\n\n---\n\n`,
          );

          for await (const event of eventStream2) {
            if (this.signal.aborted) break;
            if (event.event === 'on_chat_model_stream' && event.data?.chunk) {
              const chunk = event.data.chunk;
              const textContent = extractTextContent(chunk.content);

              if (textContent) {
                currentResponseBuffer += textContent;
                this.emitResponse(textContent);
              }
            }
            if (event.event === 'on_chat_model_end' && event.data?.output) {
              const meta =
                event.data.output.usage_metadata ||
                event.data.output.response_metadata?.usage;
              if (meta) {
                const normalized = normalizeUsageMetadata(meta);
                usageChat.input_tokens += normalized.input_tokens;
                usageChat.output_tokens += normalized.output_tokens;
                usageChat.total_tokens += normalized.total_tokens;
              }
            }
            if (
              event.event === 'on_llm_end' &&
              (event.data?.output?.llmOutput?.tokenUsage ||
                event.data?.output?.estimatedTokenUsage)
            ) {
              const t =
                event.data.output.llmOutput?.tokenUsage ||
                event.data.output.estimatedTokenUsage;
              const normalized = normalizeUsageMetadata(t);
              usageChat.input_tokens += normalized.input_tokens;
              usageChat.output_tokens += normalized.output_tokens;
              usageChat.total_tokens += normalized.total_tokens;
            }
          }
        } else {
          throw err;
        }
      }

      // Emit the final sources used for the response
      if (collectedDocuments.length > 0) {
        this.emitter.emit(
          'data',
          JSON.stringify({
            type: 'sources',
            data: collectedDocuments,
            searchQuery: '',
            searchUrl: '',
          }),
        );
      }

      // If we didn't get any streamed tokens but have a final result, emit it
      if (
        currentResponseBuffer === '' &&
        finalResult &&
        finalResult.messages &&
        finalResult.messages.length > 0
      ) {
        const finalMessage =
          finalResult.messages[finalResult.messages.length - 1];

        if (finalMessage && finalMessage.content) {
          console.log('SimplifiedAgent: Emitting complete response (fallback)');

          const text = extractTextContent(finalMessage.content);
          if (text) {
            this.emitResponse(text);
          }
        }
      }

      // If we still have no response, emit a fallback message
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

      // Clean up tool_llm_usage listener before final emission
      this.emitter.removeListener('tool_llm_usage', toolLlmUsageHandler);

      // Emit model stats and end signal after streaming is complete
      console.log(
        'SimplifiedAgent: Usage collected — chat:',
        usageChat,
        'system:',
        usageSystem,
      );
      this.emitModelStats(usageChat, usageSystem, usageImageGen);

      if (skillRunId) cleanupSkillsForRun(skillRunId);
      this.emitter.emit('end');
    } catch (error: unknown) {
      // Clean up tool_llm_usage listener on error
      if (toolLlmUsageHandler) {
        this.emitter.removeListener('tool_llm_usage', toolLlmUsageHandler);
      }

      if (skillRunId) cleanupSkillsForRun(skillRunId);

      console.error('SimplifiedAgent: Error during search and answer:', error);

      // Handle specific error types
      if (this.signal.aborted) {
        console.warn('SimplifiedAgent: Operation was aborted');
        this.emitResponse('The search operation was cancelled.');
      } else {
        // General error handling
        this.emitResponse(
          'I encountered an error while processing your request. Please try rephrasing your query or contact support if the issue persists.',
        );
      }

      this.emitter.emit('end');
    }
  }

  /**
   * Resume a paused run from a LangGraph checkpoint.
   * Called by the resume endpoint after an interrupt is answered.
   */
  async doResume(
    focusMode: string,
    fileIds: string[],
    resumeArg: unknown,
  ): Promise<void> {
    const toolLlmUsageHandler: ((data: string) => void) | null = null;
    let skillRunId: string | null = null;

    try {
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      skillRunId = runId;
      setRunContext(runId, {
        chatId: this.chatId ?? '',
        parentMessageId: this.aiMessageId ?? '',
        skills: this.resolvedSkills,
      });

      // Reconstruct workspace tools so the resumed agent can execute workspace_edit etc.
      // These tools are normally injected by route.ts as extraTools, but doResume creates
      // a fresh agent that has no knowledge of the original route's context.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resumeExtraTools: any[] = [];
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
          workspaceLsTool(this.workspaceId),
          workspaceGrepTool(this.workspaceId),
          workspaceReadTool({
            workspaceId: this.workspaceId,
            visionCapable: false,
          }),
          workspaceEditTool({
            workspaceId: this.workspaceId,
            emitter: this.emitter,
            interactiveSession: this.interactiveSession,
            messageId: this.messageId ?? '',
          }),
          workspaceCreateFileTool({
            workspaceId: this.workspaceId,
            emitter: this.emitter,
            interactiveSession: this.interactiveSession,
            messageId: this.messageId ?? '',
          }),
        );
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

      const config: RunnableConfig = {
        configurable: {
          thread_id: this.threadId ?? '',
          llm: this.chatLlm,
          systemLlm: this.systemLlm,
          embeddings: this.embeddings,
          fileIds,
          personaInstructions: this.personaInstructions,
          focusMode,
          emitter: this.emitter,
          firefoxAIDetected: false,
          messageId: this.messageId,
          runId,
          retrievalSignal: this.retrievalSignal,
          userLocation: this.userLocation,
          userProfile: this.userProfile,
          chatId: this.chatId,
          workspaceId: this.workspaceId,
          interactiveSession: this.interactiveSession,
          isPrivate: this.isPrivate,
        },
        recursionLimit: 150,
        signal: this.retrievalSignal,
      };

      const { Command } = await import('@langchain/langgraph');

      // Track active tool call run IDs so handleToolEnd can update the right widget.
      const resumeToolCalls = new Map<string, string>();
      // On resume LangGraph re-runs EVERY interrupted tool node from scratch (one
      // per pending interrupt), not just the one being answered. Each already has a
      // markup widget from the original run, so emitting tool_call_started for them
      // would create duplicates (and the un-answered ones, which re-interrupt, would
      // leave an orphaned spinner). Identify those re-invocations by the LLM
      // tool_call_id, which is stable across replays (the callback runId is not).
      // handleToolStart receives it as its 8th arg (config.toolCall.id); the pending
      // interrupts expose the same id at interrupt.value.toolCallId.
      const reinvokedToolCallIds = new Set<string>();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const preState = await (agent as any).getState({
          configurable: { thread_id: this.threadId ?? '' },
        });
        for (const task of preState?.tasks ?? []) {
          for (const intr of (task as { interrupts?: unknown[] }).interrupts ??
            []) {
            const id = (intr as { value?: { toolCallId?: string } })?.value
              ?.toolCallId;
            if (id) reinvokedToolCallIds.add(id);
          }
        }
      } catch (preStateErr) {
        console.warn(
          '[simplifiedAgent] resume pre-state interrupt scan failed:',
          preStateErr,
        );
      }
      // cbRunIds of the re-invoked interrupted tools, recorded as they start so
      // handleToolEnd/handleToolError can recognize them by runId.
      const resumedToolRunIds = new Set<string>();

      const eventStream = agent.streamEvents(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Command({ resume: resumeArg }) as any,
        {
          ...config,
          version: 'v2',
          callbacks: [
            {
              handleToolStart: (
                _tool: unknown,
                input: unknown,
                cbRunId: string,
                _parentRunId?: string,
                _tags?: string[],
                _metadata?: Record<string, unknown>,
                runName?: string,
                llmToolCallId?: string,
              ) => {
                const toolName =
                  runName ||
                  (_tool as { name?: string } | undefined)?.name ||
                  '';
                if (!toolName) return;
                // Skip the re-invocations of the interrupted tools, matched by
                // their stable LLM tool_call_id. Their widgets already exist from
                // the original run; emitting another tool_call_started would
                // duplicate them (and orphan the un-answered ones' spinners).
                if (llmToolCallId && reinvokedToolCallIds.has(llmToolCallId)) {
                  resumedToolRunIds.add(cbRunId);
                  resumeToolCalls.set(cbRunId, toolName);
                  return;
                }
                if (
                  toolName === 'deep_research' ||
                  toolName === 'todo_list' ||
                  toolName === 'create_chart'
                )
                  return;
                resumeToolCalls.set(cbRunId, toolName);

                const TOOL_ARG_MAX_LENGTH = 350;
                let extraAttr = '';
                try {
                  let parsed = input;
                  if (typeof input === 'string') {
                    const t = input.trim();
                    if (t.startsWith('{') && t.endsWith('}'))
                      parsed = JSON.parse(t);
                  }
                  if (parsed && typeof parsed === 'object') {
                    const obj = parsed as Record<string, unknown>;
                    if (typeof obj.query === 'string')
                      extraAttr += ` query="${encodeHtmlAttribute(obj.query.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    if (
                      toolName === 'read_skill' &&
                      typeof obj.name === 'string'
                    )
                      extraAttr += ` query="${encodeHtmlAttribute(obj.name.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    if (Array.isArray(obj.urls))
                      extraAttr += ` count="${obj.urls.length}"`;
                    if (typeof obj.url === 'string')
                      extraAttr += ` url="${encodeHtmlAttribute(obj.url.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    if (typeof obj.pdfUrl === 'string')
                      extraAttr += ` url="${encodeHtmlAttribute(obj.pdfUrl.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    if (typeof obj.content === 'string' && !obj.query)
                      extraAttr += ` query="${encodeHtmlAttribute(obj.content.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    if (toolName === 'code_execution') {
                      if (typeof obj.code === 'string') {
                        extraAttr += ` code="${encodeBase64(obj.code)}"`;
                        pushCallbackRunId(obj.code, cbRunId);
                      }
                      if (typeof obj.description === 'string')
                        extraAttr += ` description="${encodeHtmlAttribute(obj.description.slice(0, 100))}"`;
                    }
                    if (toolName === 'ask_user') {
                      if (typeof obj.question === 'string') {
                        extraAttr += ` query="${encodeHtmlAttribute(obj.question.slice(0, 200))}"`;
                        pushQuestionCallbackRunId(obj.question, cbRunId);
                      }
                      if (typeof obj.context === 'string')
                        extraAttr += ` context="${encodeHtmlAttribute(obj.context.slice(0, 200))}"`;
                    }
                    if (
                      (toolName === 'workspace_edit' ||
                        toolName === 'workspace_create_file') &&
                      typeof obj.file === 'string'
                    ) {
                      extraAttr += ` query="${encodeHtmlAttribute(obj.file.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                      pushQuestionCallbackRunId(obj.file, cbRunId);
                    }
                    if (
                      toolName === 'edit_skill' &&
                      typeof obj.name === 'string'
                    )
                      pushQuestionCallbackRunId(obj.name, cbRunId);
                    if (
                      toolName === 'workspace_read' &&
                      typeof obj.file === 'string'
                    )
                      extraAttr += ` query="${encodeHtmlAttribute(obj.file.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                    if (
                      toolName === 'workspace_grep' &&
                      typeof obj.pattern === 'string'
                    )
                      extraAttr += ` query="${encodeHtmlAttribute(obj.pattern.slice(0, TOOL_ARG_MAX_LENGTH))}"`;
                  }
                } catch {
                  // ignore attribute extraction errors
                }
                this.emitter.emit(
                  'data',
                  JSON.stringify({
                    type: 'tool_call_started',
                    data: {
                      content: `<ToolCall type="${encodeHtmlAttribute(toolName)}" status="running" toolCallId="${encodeHtmlAttribute(cbRunId)}"${extraAttr}></ToolCall>`,
                      toolCallId: cbRunId,
                      status: 'running',
                    },
                  }),
                );
              },
              handleToolEnd: (_output: unknown, cbRunId: string) => {
                const name = resumeToolCalls.get(cbRunId);
                if (!name) return;
                resumeToolCalls.delete(cbRunId);
                // Finished without interrupting → drop any stale correlation
                // entry so a later same-key interrupt doesn't pop this dead id.
                dropQuestionCallbackRunId(cbRunId);
                dropCodeCallbackRunId(cbRunId);
                // resumeRun already emitted tool_call_success for the resumed tools
                if (resumedToolRunIds.has(cbRunId)) return;
                this.emitter.emit(
                  'data',
                  JSON.stringify({
                    type: 'tool_call_success',
                    data: { toolCallId: cbRunId, status: 'success' },
                  }),
                );
              },
              handleToolError: (err: unknown, cbRunId: string) => {
                if (isGraphInterrupt(err)) {
                  resumeToolCalls.delete(cbRunId);
                  return;
                }
                const name = resumeToolCalls.get(cbRunId);
                if (!name) return;
                resumeToolCalls.delete(cbRunId);
                dropQuestionCallbackRunId(cbRunId);
                dropCodeCallbackRunId(cbRunId);
                if (resumedToolRunIds.has(cbRunId)) return;
                const msg =
                  (err instanceof Error ? err.message : String(err)) ||
                  'Unknown tool error';
                this.emitter.emit(
                  'data',
                  JSON.stringify({
                    type: 'tool_call_error',
                    data: {
                      toolCallId: cbRunId,
                      status: 'error',
                      error: msg.substring(0, 500),
                    },
                  }),
                );
              },
            },
          ],
        },
      );

      for await (const event of eventStream) {
        if (this.signal.aborted) break;

        if (event.event === 'on_chat_model_stream' && event.data?.chunk) {
          const chunk = event.data.chunk;
          const textContent = extractTextContent(chunk.content);
          if (textContent) this.emitResponse(textContent);
        }
      }

      // Check for further interrupts after resume stream
      if (!this.signal.aborted && this.threadId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const agentState = await (agent as any).getState({
            configurable: { thread_id: this.threadId },
          });
          const pendingInterrupts = (agentState?.tasks ?? []).flatMap(
            (t: { interrupts?: unknown[] }) => t.interrupts ?? [],
          );
          if (pendingInterrupts.length > 0) {
            this.emitter.emit('interrupts', JSON.stringify(pendingInterrupts));
            if (skillRunId) cleanupSkillsForRun(skillRunId);
            return;
          }
        } catch (stateErr) {
          console.warn(
            '[simplifiedAgent] resume interrupt state check failed:',
            stateErr,
          );
        }
      }

      if (skillRunId) cleanupSkillsForRun(skillRunId);
      this.emitter.emit('end');
    } catch (error: unknown) {
      if (toolLlmUsageHandler) {
        this.emitter.removeListener('tool_llm_usage', toolLlmUsageHandler);
      }
      if (skillRunId) cleanupSkillsForRun(skillRunId);
      console.error('[SimplifiedAgent] doResume error:', error);
      this.emitter.emit('error', JSON.stringify({ data: String(error) }));
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
