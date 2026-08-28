import type { EventEmitter } from 'events';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { Document } from '@langchain/core/documents';
import type { RunnableConfig } from '@langchain/core/runnables';
import { isGraphInterrupt } from '@langchain/langgraph';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import type { CapabilityRuntimeFacts } from '@/lib/capabilities/availability';
import {
  emitStreamEvent,
  type AgentEmitEvent,
  type LangGraphInterrupt,
} from '@/lib/streaming/events';
import {
  pushCallbackRunId as pushCodeCallbackRunId,
  dropCallbackRunId as dropCodeCallbackRunId,
} from '@/lib/sandbox/codeExecutionCorrelation';
import {
  pushCallbackRunId as pushQuestionCallbackRunId,
  dropCallbackRunId as dropQuestionCallbackRunId,
} from '@/lib/userQuestion/questionCorrelation';
import type { Skill } from '@/lib/skills/types';
import { toolContextSchema, type ToolContext } from '@/lib/tools/toolContext';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import type { MappingConfiguration } from '@/lib/maps/config';
import type { MappingService } from '@/lib/maps/service';
import type { Recorder, TokenTracker } from '@/lib/tokens/tracker';
import { normalizeUsageMetadata } from '@/lib/tokens/tracker';

const MCP_RESULT_MAX_LENGTH = 4000;
const TOOL_ARG_MAX_LENGTH = 350;
const SPECIALIZED_TOOL_NAMES = new Set([
  'deep_research',
  'todo_list',
  'create_chart',
  'show_chart',
  'show_map',
  'request_location',
]);

export type AgentStreamEvent = {
  event: string;
  name: string;
  run_id: string;
  metadata?: Record<string, unknown>;
  parent_ids?: string[];
  data?: {
    input?: unknown;
    output?: unknown;
    chunk?: unknown;
    error?: unknown;
  };
};

export type AgentStreamGraph = {
  getState: (config: {
    configurable: { thread_id: string };
  }) => Promise<unknown>;
};

export interface AgentStreamToolContextOptions {
  llm: BaseChatModel;
  systemLlm: BaseChatModel;
  embeddings: CachedEmbeddings;
  fileIds: string[];
  emitter: EventEmitter;
  messageId?: string;
  assistantMessageId?: string;
  runId: string;
  retrievalSignal?: AbortSignal;
  userLocation?: string;
  userProfile?: string;
  chatId?: string;
  /** LangGraph checkpoint thread binding for transient location tokens. */
  threadId?: string;
  workspaceId?: string | null;
  interactiveSession: boolean;
  isPrivate: boolean;
  tracker: TokenTracker;
  chatRecorder: Recorder;
  systemRecorder: Recorder;
  chartRegistry: TurnChartRegistry;
  /** Current turn's provider-grounded map registry. */
  mapRegistry?: TurnMapRegistry;
  mappingConfig?: MappingConfiguration | null;
  mappingService?: MappingService | null;
  mappingServiceResolver?: () => MappingService | null;
  mappingSavedLocationEnabled?: boolean;
  /** Opaque current-location token; exact coordinates stay server-side. */
  locationToken?: string;
  /** Approval that minted the token; prevents cross-approval token reuse. */
  locationApprovalId?: string;
  clientSessionId?: string;
  capabilityFacts?: () => CapabilityRuntimeFacts;
}

/** Build the one validated ToolContext used by every stream in a run. */
export function buildAgentToolContext(
  options: AgentStreamToolContextOptions,
): ToolContext {
  const context: ToolContext = {
    llm: options.llm,
    systemLlm: options.systemLlm,
    embeddings: options.embeddings,
    fileIds: options.fileIds,
    emitter: options.emitter,
    messageId: options.messageId,
    assistantMessageId: options.assistantMessageId,
    runId: options.runId,
    retrievalSignal: options.retrievalSignal,
    userLocation: options.userLocation,
    userProfile: options.userProfile,
    chatId: options.chatId,
    threadId: options.threadId,
    workspaceId: options.workspaceId,
    interactiveSession: options.interactiveSession,
    isPrivate: options.isPrivate,
    tracker: options.tracker,
    chatRecorder: options.chatRecorder,
    systemRecorder: options.systemRecorder,
    chartRegistry: options.chartRegistry,
    mapRegistry: options.mapRegistry ?? new TurnMapRegistry(),
    mappingConfig: options.mappingConfig,
    mappingService: options.mappingService,
    mappingServiceResolver: options.mappingServiceResolver,
    mappingSavedLocationEnabled: options.mappingSavedLocationEnabled,
    locationToken: options.locationToken,
    locationApprovalId: options.locationApprovalId,
    clientSessionId: options.clientSessionId,
    capabilityFacts: options.capabilityFacts,
  };
  return toolContextSchema.parse(context);
}

export interface AgentStreamDriverOptions extends AgentStreamToolContextOptions {
  signal: AbortSignal;
  resolvedSkills?: readonly Skill[];
  onResponse: (text: string) => void;
}

export interface StartStreamPolicy {
  kind: 'start';
  seededDocuments?: Document[];
  /** Emit the synthetic Firefox AI tool once the stream produces its first event. */
  firefoxAIDetected?: boolean;
  /** Documents already emitted before this stream, such as a resumed turn. */
  existingDocuments?: Document[];
}

export interface ResumeStreamPolicy {
  kind: 'resume';
  replayedToolCallIds: ReadonlySet<string>;
  /** Stable LLM tool_call_id → the original widget's callback run id. */
  originalWidgetMappings?: Readonly<Record<string, string>>;
  /** Sources already emitted before the checkpoint pause. */
  existingDocuments?: Document[];
}

export interface RespondNowStreamPolicy {
  kind: 'respond-now';
  existingDocuments?: Document[];
  emitFinalSources?: boolean;
}

export type AgentStreamPolicy =
  StartStreamPolicy | ResumeStreamPolicy | RespondNowStreamPolicy;

export interface AgentStreamResult {
  finalResult: {
    messages?: BaseMessage[];
    relevantDocuments?: Document[];
  } | null;
  collectedDocuments: Document[];
  responseText: string;
  interrupted: boolean;
  aborted: boolean;
}

export class AgentStreamIntegrityError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AgentStreamIntegrityError';
  }
}

export class AgentStreamExecutionError extends Error {
  readonly result: AgentStreamResult;

  constructor(message: string, result: AgentStreamResult, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AgentStreamExecutionError';
    this.result = result;
  }
}

interface ToolRunState {
  name: string;
  visible: boolean;
  replayed: boolean;
  targetToolCallId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseToolInput(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export function extractAgentStreamTextContent(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  let text = '';
  for (const item of content) {
    const block = asRecord(item);
    if (!block) continue;
    if (
      (block.type === 'text' || block.type === 'text_delta') &&
      typeof block.text === 'string'
    ) {
      text += block.text;
    } else if (
      (block.type === 'thinking' || block.type === 'thinking_delta') &&
      typeof block.thinking === 'string'
    ) {
      text += `<think>${block.thinking}</think>`;
    } else if (
      block.type === 'reasoning' &&
      typeof block.reasoning === 'string'
    ) {
      text += `<think>${block.reasoning}</think>`;
    }
  }
  return text;
}

function extractMcpResultContent(output: unknown): string | null {
  const record = asRecord(output);
  const update = asRecord(record?.update);
  const messages = Array.isArray(update?.messages) ? update.messages : [];
  const firstMessage = asRecord(messages[0]);
  const content =
    typeof output === 'string'
      ? output
      : (firstMessage?.content ?? record?.content);
  if (typeof content !== 'string' || content.length === 0) return null;
  return content.length > MCP_RESULT_MAX_LENGTH
    ? content.slice(0, MCP_RESULT_MAX_LENGTH) + '\n… (truncated)'
    : content;
}

function isSystemSkill(
  toolName: string,
  input: unknown,
  resolvedSkills: readonly Skill[],
): boolean {
  if (toolName !== 'read_skill') return false;
  const name = parseToolInput(input).name;
  if (typeof name !== 'string') return false;
  return resolvedSkills.some(
    (skill) => skill.name === name && skill.source === 'system',
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.toString();
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return String(error || 'Unknown tool error');
}

function extractToolExtra(
  toolName: string,
  output: unknown,
): Record<string, string> | undefined {
  const record = asRecord(output);
  let extra: Record<string, string> | undefined;

  if (toolName === 'youtube_transcript') {
    const update = asRecord(record?.update);
    const documents = Array.isArray(update?.relevantDocuments)
      ? update.relevantDocuments
      : [];
    const firstDocument = asRecord(documents[0]);
    const metadata = asRecord(firstDocument?.metadata);
    const source = metadata?.source;
    if (source) extra = { videoId: String(source) };
  }

  if (toolName === 'image_generation') {
    const update = asRecord(record?.update);
    const messages = Array.isArray(update?.messages) ? update.messages : [];
    const content = asRecord(messages[0])?.content;
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content) as { imageId?: unknown };
        if (parsed.imageId) extra = { imageId: String(parsed.imageId) };
      } catch {
        // A non-JSON image result has no widget enrichment.
      }
    }
  }

  if (toolName.startsWith('mcp__')) {
    const result = extractMcpResultContent(output);
    if (result) extra = { ...(extra ?? {}), mcpResult: result };
  }

  return extra;
}

function extractReadSkillError(
  toolName: string,
  output: unknown,
): string | null {
  if (toolName !== 'read_skill') return null;
  const record = asRecord(output);
  const content =
    typeof output === 'string'
      ? output
      : typeof record?.content === 'string'
        ? record.content
        : null;
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

function documentKey(
  document: Document,
  objectKeys: WeakMap<object, number>,
  nextKey: { value: number },
): string {
  const metadata = (document.metadata ?? {}) as Record<string, unknown>;
  // A details lookup intentionally reuses the provider's canonical place URL
  // but carries richer facts than the initial search result. Keep that
  // enrichment as a distinct source instead of silently discarding it by URL.
  if (
    metadata.processingType === 'mapping-place-details' &&
    typeof metadata.placeHandle === 'string'
  ) {
    return `mapping-place-details:${metadata.placeHandle}`;
  }
  const url = metadata.url;
  if (typeof url === 'string' && url.length > 0 && url !== 'File') {
    return `url:${url}`;
  }

  const source =
    metadata.source ?? metadata.filePath ?? metadata.path ?? metadata.filename;
  if (
    typeof source === 'string' &&
    source.length > 0 &&
    source !== 'file_search'
  ) {
    return `source:${source}`;
  }

  if (
    typeof document.pageContent === 'string' &&
    document.pageContent.length > 0
  ) {
    const title = typeof metadata.title === 'string' ? metadata.title : '';
    return `content:${title}::${document.pageContent}`;
  }

  const object = document as unknown as object;
  const existing = objectKeys.get(object);
  if (existing !== undefined) return `object:${existing}`;
  const key = nextKey.value++;
  objectKeys.set(object, key);
  return `object:${key}`;
}

class SourceAccumulator {
  private readonly documentsValue: Document[] = [];
  private readonly keys = new Set<string>();
  private readonly objectKeys = new WeakMap<object, number>();
  private nextObjectKey = { value: 1 };

  get documents(): Document[] {
    return [...this.documentsValue];
  }

  seed(documents: readonly Document[]): void {
    for (const document of documents) {
      const key = documentKey(document, this.objectKeys, this.nextObjectKey);
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.documentsValue.push(document);
    }
  }

  add(documents: readonly Document[]): Document[] {
    const fresh: Document[] = [];
    for (const document of documents) {
      const key = documentKey(document, this.objectKeys, this.nextObjectKey);
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.documentsValue.push(document);
      fresh.push(document);
    }
    return fresh;
  }
}

/** Deduplicate source documents while preserving their first-seen order. */
export function deduplicateDocuments(
  documents: readonly Document[],
): Document[] {
  const sources = new SourceAccumulator();
  sources.seed(documents);
  return sources.documents;
}

class ParentChildAttributionTracker {
  private readonly deepResearchRunIds = new Set<string>();
  private readonly parentToolsNodeRunIds = new Set<string>();
  private readonly activeAgentLlmRunIds = new Set<string>();
  private readonly recordedUsageRunIds = new Set<string>();
  private readonly responseRuns = new Set<string>();

  observe(event: AgentStreamEvent, respondNow: boolean): void {
    const metadata = event.metadata ?? {};
    const parentIds = event.parent_ids ?? [];
    const nestedInDeepResearch = parentIds.some((id) =>
      this.deepResearchRunIds.has(id),
    );

    if (event.event === 'on_tool_start' && event.name === 'deep_research') {
      this.deepResearchRunIds.add(event.run_id);
    }
    if (
      (event.event === 'on_tool_end' || event.event === 'on_tool_error') &&
      event.name === 'deep_research'
    ) {
      this.deepResearchRunIds.delete(event.run_id);
    }

    if (
      event.event === 'on_chain_start' &&
      metadata.langgraph_node === 'tools' &&
      !nestedInDeepResearch
    ) {
      this.parentToolsNodeRunIds.add(event.run_id);
    }
    if (
      (event.event === 'on_chain_end' || event.event === 'on_chain_error') &&
      metadata.langgraph_node === 'tools'
    ) {
      this.parentToolsNodeRunIds.delete(event.run_id);
    }

    if (event.event === 'on_chat_model_start') {
      if (respondNow) {
        this.responseRuns.add(event.run_id);
      } else if (
        metadata.langgraph_node === 'model_request' &&
        !nestedInDeepResearch
      ) {
        this.activeAgentLlmRunIds.add(event.run_id);
      }
    }
  }

  isParentTool(parentRunId: string | undefined): boolean {
    return !parentRunId || this.parentToolsNodeRunIds.has(parentRunId);
  }

  isParentModel(event: AgentStreamEvent, respondNow: boolean): boolean {
    if (respondNow) {
      return (
        this.responseRuns.size === 0 || this.responseRuns.has(event.run_id)
      );
    }
    return (
      event.metadata?.langgraph_node === 'model_request' &&
      this.activeAgentLlmRunIds.has(event.run_id)
    );
  }

  hasRecordedUsage(runId: string): boolean {
    return this.recordedUsageRunIds.has(runId);
  }

  markUsageRecorded(runId: string): void {
    this.recordedUsageRunIds.add(runId);
  }
}

function groupDocuments(
  documents: readonly Document[],
): Map<string, Document[]> {
  const grouped = new Map<string, Document[]>();
  for (const document of documents) {
    const query =
      typeof document.metadata?.searchQuery === 'string'
        ? document.metadata.searchQuery
        : 'Agent Search';
    const existing = grouped.get(query);
    if (existing) existing.push(document);
    else grouped.set(query, [document]);
  }
  return grouped;
}

function documentsFromToolOutput(output: unknown): Document[] {
  const documents: Document[] = [];
  const outputRecord = asRecord(output);
  const direct =
    outputRecord?.relevantDocuments ??
    asRecord(outputRecord?.update)?.relevantDocuments;
  if (Array.isArray(direct)) documents.push(...(direct as Document[]));

  if (!Array.isArray(output)) return documents;
  for (const item of output) {
    const itemRecord = asRecord(item);
    const update = asRecord(itemRecord?.update);
    const relevantDocuments =
      asRecord(update)?.relevantDocuments ?? itemRecord?.relevantDocuments;
    if (Array.isArray(relevantDocuments)) {
      documents.push(...(relevantDocuments as Document[]));
    }
  }
  return documents;
}

function pendingInterruptsFromState(state: unknown): LangGraphInterrupt[] {
  const record = asRecord(state);
  if (!record || !Array.isArray(record.tasks)) {
    throw new AgentStreamIntegrityError(
      'LangGraph checkpoint state did not contain a task list.',
    );
  }
  const interrupts: LangGraphInterrupt[] = [];
  for (const task of record.tasks) {
    const taskRecord = asRecord(task);
    if (!taskRecord) {
      throw new AgentStreamIntegrityError(
        'LangGraph checkpoint state contained an invalid task.',
      );
    }
    if (!Array.isArray(taskRecord.interrupts)) continue;
    for (const interrupt of taskRecord.interrupts) {
      interrupts.push(interrupt as LangGraphInterrupt);
    }
  }
  return interrupts;
}

function replayedToolCallIdsFromInterrupts(
  interrupts: readonly LangGraphInterrupt[],
): Set<string> {
  const ids = new Set<string>();
  for (const interrupt of interrupts) {
    const id = interrupt?.value?.toolCallId;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return ids;
}

export class AgentStreamDriver {
  private readonly options: AgentStreamDriverOptions;
  private readonly resolvedSkills: readonly Skill[];

  constructor(options: AgentStreamDriverOptions) {
    this.options = options;
    this.resolvedSkills = options.resolvedSkills ?? [];
  }

  /** Build the LangGraph config and the run-scoped native tool context. */
  buildConfig(): RunnableConfig & { context: ToolContext } {
    const context = buildAgentToolContext({
      llm: this.options.llm,
      systemLlm: this.options.systemLlm,
      embeddings: this.options.embeddings,
      fileIds: this.options.fileIds,
      emitter: this.options.emitter,
      messageId: this.options.messageId,
      assistantMessageId: this.options.assistantMessageId,
      runId: this.options.runId,
      retrievalSignal: this.options.retrievalSignal,
      userLocation: this.options.userLocation,
      userProfile: this.options.userProfile,
      chatId: this.options.chatId,
      threadId: this.options.threadId,
      workspaceId: this.options.workspaceId,
      interactiveSession: this.options.interactiveSession,
      isPrivate: this.options.isPrivate,
      tracker: this.options.tracker,
      chatRecorder: this.options.chatRecorder,
      systemRecorder: this.options.systemRecorder,
      chartRegistry: this.options.chartRegistry,
      mapRegistry: this.options.mapRegistry,
      mappingConfig: this.options.mappingConfig,
      mappingService: this.options.mappingService,
      mappingServiceResolver: this.options.mappingServiceResolver,
      mappingSavedLocationEnabled: this.options.mappingSavedLocationEnabled,
      locationToken: this.options.locationToken,
      locationApprovalId: this.options.locationApprovalId,
      clientSessionId: this.options.clientSessionId,
      capabilityFacts: this.options.capabilityFacts,
    });

    return {
      configurable: {
        thread_id: this.options.threadId ?? `simplified_agent_${Date.now()}`,
      },
      context,
      recursionLimit: 150,
      signal: this.options.retrievalSignal,
    };
  }

  callbacks(policy: AgentStreamPolicy): Array<Record<string, unknown>> {
    const replayed =
      policy.kind === 'resume' ? policy.replayedToolCallIds : new Set<string>();
    const originalMappings =
      policy.kind === 'resume' ? (policy.originalWidgetMappings ?? {}) : {};
    const toolRuns = new Map<string, ToolRunState>();

    return [
      {
        handleToolStart: (
          tool: unknown,
          input: unknown,
          runId: string,
          parentRunId?: string,
          _tags?: string[],
          _metadata?: Record<string, unknown>,
          runName?: string,
          stableToolCallId?: string,
        ) => {
          const toolRecord = asRecord(tool);
          const toolName =
            runName ||
            (typeof toolRecord?.name === 'string' ? toolRecord.name : '') ||
            'unknown';
          const stableId =
            stableToolCallId ??
            (typeof _metadata?.toolCallId === 'string'
              ? _metadata.toolCallId
              : typeof _metadata?.tool_call_id === 'string'
                ? _metadata.tool_call_id
                : undefined);
          const replayedTool =
            policy.kind === 'resume' &&
            stableId !== undefined &&
            replayed.has(stableId);
          const targetToolCallId =
            (stableId && originalMappings[stableId]) || runId;
          const specialized = SPECIALIZED_TOOL_NAMES.has(toolName);
          const nested = !this.currentAttribution.isParentTool(parentRunId);
          const systemSkill = isSystemSkill(
            toolName,
            input,
            this.resolvedSkills,
          );
          const visible =
            !replayedTool && !specialized && !nested && !systemSkill;

          toolRuns.set(runId, {
            name: toolName,
            visible,
            replayed: replayedTool,
            targetToolCallId,
          });

          if (!visible) return;

          const parsedInput = parseToolInput(input);
          const attrs = this.extractToolAttributes(
            toolName,
            parsedInput,
            runId,
          );
          emitStreamEvent(this.options.emitter, {
            type: 'tool_call_started',
            data: {
              toolCallId: runId,
              toolType: toolName.trim(),
              status: 'running',
              attrs,
            },
          });
        },
        handleToolEnd: (output: unknown, runId: string) => {
          const state = toolRuns.get(runId);
          if (!state) return;
          toolRuns.delete(runId);
          this.clearCorrelations(runId);

          const readSkillError = extractReadSkillError(state.name, output);
          if (readSkillError) {
            const toolCallId = state.replayed ? state.targetToolCallId : runId;
            if (state.visible || state.replayed) {
              emitStreamEvent(this.options.emitter, {
                type: 'tool_call_error',
                data: {
                  toolCallId,
                  status: 'error',
                  error: readSkillError.substring(0, 500),
                },
              });
            }
            return;
          }

          if (!state.visible && !state.replayed) return;
          const extra = extractToolExtra(state.name, output);
          if (state.replayed) {
            // The resume host already closes the original widget. Only emit the
            // result enrichment here, and always target the original widget.
            if (extra) {
              emitStreamEvent(this.options.emitter, {
                type: 'tool_call_success',
                data: {
                  toolCallId: state.targetToolCallId,
                  status: 'success',
                  extra,
                },
              });
            }
            return;
          }

          emitStreamEvent(this.options.emitter, {
            type: 'tool_call_success',
            data: {
              toolCallId: runId,
              status: 'success',
              ...(extra ? { extra } : {}),
            },
          });
        },
        handleToolError: (error: unknown, runId: string) => {
          const state = toolRuns.get(runId);
          if (isGraphInterrupt(error)) {
            toolRuns.delete(runId);
            return;
          }
          if (!state) return;
          toolRuns.delete(runId);
          this.clearCorrelations(runId);
          if (!state.visible && !state.replayed) return;

          emitStreamEvent(this.options.emitter, {
            type: 'tool_call_error',
            data: {
              toolCallId: state.replayed ? state.targetToolCallId : runId,
              status: 'error',
              error: errorMessage(error).substring(0, 500),
            },
          });
        },
      },
    ];
  }

  /**
   * Inspect the paused checkpoint before replaying it. Failure is fatal: a
   * resume without a trustworthy replay set can duplicate or mis-target tools.
   */
  async prepareResumePolicy(
    graph: AgentStreamGraph,
    originalWidgetMappings: Readonly<Record<string, string>> = {},
    existingDocuments: Document[] = [],
  ): Promise<ResumeStreamPolicy> {
    const state = await this.readCheckpointState(graph, 'resume preparation');
    return {
      kind: 'resume',
      replayedToolCallIds: replayedToolCallIdsFromInterrupts(
        pendingInterruptsFromState(state),
      ),
      originalWidgetMappings,
      existingDocuments,
    };
  }

  async consume(
    stream: AsyncIterable<AgentStreamEvent>,
    policy: AgentStreamPolicy,
    graph?: AgentStreamGraph,
  ): Promise<AgentStreamResult> {
    const attribution = new ParentChildAttributionTracker();
    this.currentAttribution = attribution;
    const sources = new SourceAccumulator();
    if (policy.kind === 'start') {
      sources.seed(policy.existingDocuments ?? []);
      const seeded = sources.add(policy.seededDocuments ?? []);
      this.emitSourcesAdded(seeded, 'Panel sources');
    } else if (policy.kind === 'resume') {
      sources.seed(policy.existingDocuments ?? []);
    } else if (policy.kind === 'respond-now') {
      sources.seed(policy.existingDocuments ?? []);
    }

    let finalResult: AgentStreamResult['finalResult'] = null;
    let responseText = '';
    let interrupted = false;
    let aborted = false;
    let firstEvent = true;
    const respondNow = policy.kind === 'respond-now';

    try {
      for await (const event of stream) {
        if (this.options.signal.aborted) {
          aborted = true;
          break;
        }

        if (firstEvent) {
          firstEvent = false;
          if (policy.kind === 'start' && policy.firefoxAIDetected) {
            emitStreamEvent(this.options.emitter, {
              type: 'tool_call_started',
              data: {
                toolCallId: `firefoxAI-${Date.now()}`,
                toolType: 'firefoxAI',
                status: 'success',
              },
            });
          }
        }

        attribution.observe(event, respondNow);
        this.foldSources(event, sources);

        if (
          event.event === 'on_chain_end' &&
          event.name === 'RunnableSequence'
        ) {
          const output = asRecord(event.data?.output);
          if (output) {
            finalResult = {
              messages: Array.isArray(output.messages)
                ? (output.messages as BaseMessage[])
                : undefined,
              relevantDocuments: Array.isArray(output.relevantDocuments)
                ? (output.relevantDocuments as Document[])
                : undefined,
            };
          }
        }

        this.foldUsage(event, attribution, respondNow);

        if (
          event.event === 'on_chat_model_stream' &&
          event.data?.chunk &&
          attribution.isParentModel(event, respondNow)
        ) {
          const chunk = asRecord(event.data.chunk);
          const text = extractAgentStreamTextContent(chunk?.content);
          if (text) {
            responseText += text;
            this.options.onResponse(text);
          }
        }
      }

      if (
        policy.kind === 'respond-now' &&
        policy.emitFinalSources &&
        sources.documents.length > 0
      ) {
        this.emitFinalSources(sources.documents);
      } else if (policy.kind !== 'respond-now') {
        if (!aborted && this.options.threadId && graph) {
          const state = await this.readCheckpointState(
            graph,
            'post-stream scan',
          );
          const pendingInterrupts = pendingInterruptsFromState(state);
          if (pendingInterrupts.length > 0) {
            interrupted = true;
            emitStreamEvent(this.options.emitter, {
              type: 'interrupt',
              interrupts: pendingInterrupts,
            });
          } else if (sources.documents.length > 0) {
            this.emitFinalSources(sources.documents);
          }
        } else if (sources.documents.length > 0) {
          this.emitFinalSources(sources.documents);
        }
      }
    } catch (error) {
      if (error instanceof AgentStreamIntegrityError) throw error;
      throw new AgentStreamExecutionError(
        'LangChain stream failed.',
        {
          finalResult,
          collectedDocuments: sources.documents,
          responseText,
          interrupted,
          aborted,
        },
        error,
      );
    }

    return {
      finalResult,
      collectedDocuments: sources.documents,
      responseText,
      interrupted,
      aborted,
    };
  }

  private currentAttribution = new ParentChildAttributionTracker();

  private foldSources(
    event: AgentStreamEvent,
    sources: SourceAccumulator,
  ): void {
    if (event.event !== 'on_chain_end') return;

    const output = event.data?.output;
    if (event.name === 'RunnableSequence') {
      const finalOutput = asRecord(output);
      const documents = Array.isArray(finalOutput?.relevantDocuments)
        ? (finalOutput.relevantDocuments as Document[])
        : [];
      this.emitSourcesAdded(sources.add(documents));
    } else {
      const outputRecord = asRecord(output);
      const directDocuments =
        outputRecord?.relevantDocuments ??
        asRecord(outputRecord?.update)?.relevantDocuments;
      if (Array.isArray(directDocuments)) {
        this.emitSourcesAdded(sources.add(directDocuments as Document[]));
      }
    }

    // Tool names are not required to contain "search" or "tool" (for
    // example, get_place_details and get_route), so recognize a tool output
    // by its structured document payload rather than by its callback name.
    const toolDocuments = documentsFromToolOutput(output);
    if (toolDocuments.length > 0) {
      this.emitSourcesAdded(sources.add(toolDocuments));
    }
  }

  private foldUsage(
    event: AgentStreamEvent,
    attribution: ParentChildAttributionTracker,
    respondNow: boolean,
  ): void {
    if (!event.data?.output) return;
    if (event.event !== 'on_chat_model_end' && event.event !== 'on_llm_end') {
      return;
    }
    if (!attribution.isParentModel(event, respondNow)) return;
    if (attribution.hasRecordedUsage(event.run_id)) return;

    const output = asRecord(event.data.output);
    if (!output) return;
    const usage =
      (asRecord(output.usage_metadata) as Record<string, number> | null) ??
      (asRecord(output.response_metadata)?.usage as
        Record<string, number> | undefined) ??
      (asRecord(output.llmOutput)?.tokenUsage as
        Record<string, number> | undefined) ??
      (output.estimatedTokenUsage as Record<string, number> | undefined);
    if (!usage) return;

    attribution.markUsageRecorded(event.run_id);
    this.options.chatRecorder.record(normalizeUsageMetadata(usage));
  }

  private emitSourcesAdded(
    documents: readonly Document[],
    searchQuery = '',
  ): void {
    if (documents.length === 0) return;
    if (searchQuery) {
      emitStreamEvent(this.options.emitter, {
        type: 'sources_added',
        data: [...documents],
        searchQuery,
        searchUrl: '',
      });
      return;
    }
    for (const [query, grouped] of groupDocuments(documents)) {
      emitStreamEvent(this.options.emitter, {
        type: 'sources_added',
        data: grouped,
        searchQuery: query,
        searchUrl: '',
      });
    }
  }

  private emitFinalSources(documents: readonly Document[]): void {
    emitStreamEvent(this.options.emitter, {
      type: 'sources',
      data: [...documents],
      searchQuery: '',
      searchUrl: '',
    });
  }

  private extractToolAttributes(
    toolName: string,
    input: Record<string, unknown>,
    runId: string,
  ): Record<string, unknown> {
    const attrs: Record<string, unknown> = {};
    if (typeof input.query === 'string') {
      attrs.query = input.query.slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (toolName === 'read_skill' && typeof input.name === 'string') {
      attrs.query = input.name.slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (Array.isArray(input.urls)) attrs.count = input.urls.length;
    if (typeof input.url === 'string') {
      attrs.url = input.url.slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (typeof input.pdfUrl === 'string') {
      attrs.url = input.pdfUrl.slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (typeof input.content === 'string' && !input.query) {
      attrs.query = input.content.slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (toolName === 'code_execution' && typeof input.code === 'string') {
      attrs.code = input.code;
      pushCodeCallbackRunId(input.code, runId);
      if (typeof input.description === 'string') {
        attrs.description = input.description.slice(0, 100);
      }
    }
    if (toolName === 'ask_user' && typeof input.question === 'string') {
      attrs.query = input.question.slice(0, 200);
      pushQuestionCallbackRunId(input.question, runId);
      if (typeof input.context === 'string') {
        attrs.context = input.context.slice(0, 200);
      }
    }
    if (toolName === 'get_message' && input.messageId !== undefined) {
      attrs.query = String(input.messageId);
    }
    if (toolName === 'chat_history_search' && Array.isArray(input.keywords)) {
      attrs.query = input.keywords
        .filter((keyword): keyword is string => typeof keyword === 'string')
        .join(', ')
        .slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (toolName === 'search_places') {
      if (typeof input.near === 'string') {
        attrs.query = input.near.slice(0, TOOL_ARG_MAX_LENGTH);
      } else if (typeof input.location === 'string') {
        attrs.query = input.location.slice(0, TOOL_ARG_MAX_LENGTH);
      }
      if (typeof input.category === 'string') {
        attrs.category = input.category.slice(0, 80);
      }
    }
    if (toolName === 'get_place_details') {
      const handle = input.placeHandle ?? input.handle;
      if (typeof handle === 'string') attrs.query = handle.slice(0, 80);
    }
    if (toolName === 'get_route') {
      if (typeof input.origin === 'string')
        attrs.origin = input.origin.slice(0, TOOL_ARG_MAX_LENGTH);
      if (typeof input.destination === 'string')
        attrs.destination = input.destination.slice(0, TOOL_ARG_MAX_LENGTH);
      if (typeof input.mode === 'string') attrs.mode = input.mode;
    }
    if (toolName === 'show_map') {
      const placeHandles = Array.isArray(input.placeHandles)
        ? input.placeHandles.filter(
            (handle): handle is string => typeof handle === 'string',
          )
        : [];
      const routeHandle =
        typeof input.routeHandle === 'string' ? input.routeHandle : undefined;
      const selection = [
        ...(placeHandles.length > 0
          ? [`places: ${placeHandles.join(', ')}`]
          : []),
        ...(routeHandle ? [`route: ${routeHandle}`] : []),
      ].join(' · ');
      if (selection) attrs.query = selection.slice(0, TOOL_ARG_MAX_LENGTH);
      if (typeof input.title === 'string') {
        attrs.description = input.title.slice(0, 100);
      }
    }
    if (toolName === 'workspace_read' && typeof input.file === 'string') {
      attrs.query = input.file.slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (toolName === 'workspace_grep' && typeof input.pattern === 'string') {
      attrs.query = input.pattern.slice(0, TOOL_ARG_MAX_LENGTH);
    }
    if (
      (toolName === 'workspace_edit' || toolName === 'workspace_create_file') &&
      typeof input.file === 'string'
    ) {
      attrs.query = input.file.slice(0, TOOL_ARG_MAX_LENGTH);
      pushQuestionCallbackRunId(input.file, runId);
    }
    if (toolName === 'edit_skill' && typeof input.name === 'string') {
      pushQuestionCallbackRunId(input.name, runId);
    }
    if (toolName.startsWith('mcp__')) {
      pushQuestionCallbackRunId(toolName, runId);
      try {
        const json = JSON.stringify(input);
        if (json && json !== '{}') attrs.mcpArgs = json;
      } catch {
        // Ignore unserializable tool arguments.
      }
    }
    return attrs;
  }

  private clearCorrelations(runId: string): void {
    dropQuestionCallbackRunId(runId);
    dropCodeCallbackRunId(runId);
  }

  private async readCheckpointState(
    graph: AgentStreamGraph,
    phase: string,
  ): Promise<unknown> {
    if (!this.options.threadId) {
      throw new AgentStreamIntegrityError(
        `Cannot perform ${phase}: no LangGraph checkpoint thread is configured.`,
      );
    }
    try {
      return await graph.getState({
        configurable: { thread_id: this.options.threadId },
      });
    } catch (error) {
      throw new AgentStreamIntegrityError(
        `LangGraph checkpoint ${phase} failed.`,
        error,
      );
    }
  }
}

export type { AgentEmitEvent };
