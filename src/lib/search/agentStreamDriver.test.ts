import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { Document } from '@langchain/core/documents';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { onStreamEvent, type AgentEmitEvent } from '@/lib/streaming/events';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import type { MappingConfiguration } from '@/lib/maps/config';
import type { MappingService } from '@/lib/maps/service';
import { TokenTracker } from '@/lib/tokens/tracker';
import type { Skill } from '@/lib/skills/types';
import {
  AgentStreamDriver,
  AgentStreamExecutionError,
  AgentStreamIntegrityError,
  buildAgentToolContext,
  type AgentStreamEvent,
  type AgentStreamPolicy,
} from './agentStreamDriver';

const usage = (input_tokens: number, output_tokens: number) => ({
  input_tokens,
  output_tokens,
  total_tokens: input_tokens + output_tokens,
});

const document = (
  source: string,
  pageContent = source,
  searchQuery?: string,
): Document =>
  ({
    pageContent,
    metadata: { source, ...(searchQuery ? { searchQuery } : {}) },
  }) as Document;

const documentWithUrl = (
  source: string,
  url: string,
  pageContent: string,
  searchQuery?: string,
): Document =>
  ({
    pageContent,
    metadata: {
      source,
      url,
      ...(searchQuery ? { searchQuery } : {}),
    },
  }) as Document;

function streamEvent(
  event: string,
  name: string,
  run_id: string,
  options: Pick<AgentStreamEvent, 'data' | 'metadata' | 'parent_ids'> = {},
): AgentStreamEvent {
  return { event, name, run_id, ...options };
}

async function* streamOf(
  events: readonly AgentStreamEvent[],
): AsyncGenerator<AgentStreamEvent> {
  for (const event of events) yield event;
}

type ToolCallbacks = {
  handleToolStart: (
    tool: unknown,
    input: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
    stableToolCallId?: string,
  ) => void;
  handleToolEnd: (output: unknown, runId: string) => void;
  handleToolError: (error: unknown, runId: string) => void;
};

function toolCallbacks(
  driver: AgentStreamDriver,
  policy: AgentStreamPolicy,
): ToolCallbacks {
  return driver.callbacks(policy)[0] as unknown as ToolCallbacks;
}

function makeHarness(
  options: {
    signal?: AbortSignal;
    threadId?: string;
    resolvedSkills?: readonly Skill[];
    mapRegistry?: TurnMapRegistry;
    mappingConfig?: MappingConfiguration | null;
    mappingService?: MappingService | null;
    mappingServiceResolver?: () => MappingService | null;
    mappingSavedLocationEnabled?: boolean;
  } = {},
) {
  const emitter = new EventEmitter();
  const events: AgentEmitEvent[] = [];
  onStreamEvent(emitter, (event) => events.push(event));

  const tracker = new TokenTracker(emitter);
  const chatRecorder = tracker.register({
    provider: 'test',
    model: 'chat-model',
    role: 'chat',
  });
  const systemRecorder = tracker.register({
    provider: 'test',
    model: 'system-model',
    role: 'system',
  });
  const responses: string[] = [];
  const driver = new AgentStreamDriver({
    llm: {} as BaseChatModel,
    systemLlm: {} as BaseChatModel,
    embeddings: {} as CachedEmbeddings,
    fileIds: ['file-1'],
    emitter,
    messageId: 'message-1',
    assistantMessageId: 'assistant-1',
    runId: 'run-1',
    chatId: 'chat-1',
    workspaceId: null,
    interactiveSession: true,
    isPrivate: false,
    tracker,
    chatRecorder,
    systemRecorder,
    chartRegistry: new TurnChartRegistry(),
    mapRegistry: options.mapRegistry,
    mappingConfig: options.mappingConfig,
    mappingService: options.mappingService,
    mappingServiceResolver: options.mappingServiceResolver,
    mappingSavedLocationEnabled: options.mappingSavedLocationEnabled,
    signal: options.signal ?? new AbortController().signal,
    threadId: options.threadId ?? 'thread-1',
    resolvedSkills: options.resolvedSkills,
    onResponse: (text) => responses.push(text),
  });

  return { driver, emitter, events, responses, tracker, chatRecorder };
}

describe('AgentStreamDriver', () => {
  it('builds one validated run context and preserves the checkpoint thread', () => {
    const { driver } = makeHarness();

    const config = driver.buildConfig();

    expect(config).toMatchObject({
      configurable: { thread_id: 'thread-1' },
      recursionLimit: 150,
      context: {
        fileIds: ['file-1'],
        messageId: 'message-1',
        assistantMessageId: 'assistant-1',
        runId: 'run-1',
        chatId: 'chat-1',
        workspaceId: null,
        interactiveSession: true,
        isPrivate: false,
      },
    });
  });

  it('threads the map registry, mapping snapshot, service resolver, and consent through the validated context', () => {
    const mapRegistry = new TurnMapRegistry();
    const mappingConfig = {} as MappingConfiguration;
    const mappingService = {} as MappingService;
    const mappingServiceResolver = vi.fn(() => mappingService);
    const { driver } = makeHarness({
      mapRegistry,
      mappingConfig,
      mappingService,
      mappingServiceResolver,
      mappingSavedLocationEnabled: true,
    });

    const config = driver.buildConfig();

    expect(config.context).toMatchObject({
      mapRegistry,
      mappingConfig,
      mappingService,
      mappingServiceResolver,
      mappingSavedLocationEnabled: true,
    });
    expect(
      buildAgentToolContext({
        ...{
          llm: {} as BaseChatModel,
          systemLlm: {} as BaseChatModel,
          embeddings: {} as CachedEmbeddings,
          fileIds: [],
          emitter: new EventEmitter(),
          runId: 'context-run',
          interactiveSession: true,
          isPrivate: false,
          tracker: new TokenTracker(new EventEmitter()),
          chatRecorder: {} as never,
          systemRecorder: {} as never,
          chartRegistry: new TurnChartRegistry(),
          mapRegistry,
          mappingConfig,
          mappingService,
          mappingServiceResolver,
          mappingSavedLocationEnabled: true,
        },
      }).mapRegistry,
    ).toBe(mapRegistry);
  });

  it('folds parent response text, usage, final results, and deduplicated sources', async () => {
    const seeded = document('https://example.test/seed', 'seed');
    const duplicate = document(
      'https://example.test/seed',
      'same source again',
    );
    const added = document('https://example.test/new', 'new', 'web search');
    const finalMessage = { content: 'complete answer' } as BaseMessage;
    const { driver, events, responses, tracker } = makeHarness();
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    const result = await driver.consume(
      streamOf([
        streamEvent('on_chat_model_start', 'chat', 'model-1', {
          metadata: { langgraph_node: 'model_request' },
        }),
        streamEvent('on_chat_model_stream', 'chat', 'model-1', {
          metadata: { langgraph_node: 'model_request' },
          data: { chunk: { content: 'hello' } },
        }),
        streamEvent('on_chat_model_stream', 'chat', 'model-1', {
          metadata: { langgraph_node: 'model_request' },
          data: {
            chunk: {
              content: [
                { type: 'thinking', thinking: 'considering' },
                { type: 'text', text: ' world' },
              ],
            },
          },
        }),
        streamEvent('on_chat_model_end', 'chat', 'model-1', {
          metadata: { langgraph_node: 'model_request' },
          data: { output: { usage_metadata: usage(10, 5) } },
        }),
        // The same callback run must not be recorded twice.
        streamEvent('on_chat_model_end', 'chat', 'model-1', {
          metadata: { langgraph_node: 'model_request' },
          data: { output: { usage_metadata: usage(99, 99) } },
        }),
        streamEvent('on_chain_end', 'web_search', 'search-1', {
          data: { output: { relevantDocuments: [duplicate, added] } },
        }),
        streamEvent('on_chain_end', 'RunnableSequence', 'graph-1', {
          data: {
            output: {
              messages: [finalMessage],
              relevantDocuments: [seeded, added],
            },
          },
        }),
      ]),
      { kind: 'start', seededDocuments: [seeded] },
      graph,
    );

    expect(responses).toEqual(['hello', '<think>considering</think> world']);
    expect(result.responseText).toBe('hello<think>considering</think> world');
    expect(result.finalResult).toEqual({
      messages: [finalMessage],
      relevantDocuments: [seeded, added],
    });
    expect(tracker.perModel()).toEqual([
      { provider: 'test', model: 'chat-model', usage: usage(10, 5) },
    ]);
    expect(events.filter((event) => event.type === 'sources_added')).toEqual([
      {
        type: 'sources_added',
        data: [seeded],
        searchQuery: 'Panel sources',
        searchUrl: '',
      },
      {
        type: 'sources_added',
        data: [added],
        searchQuery: 'web search',
        searchUrl: '',
      },
    ]);
    expect(events.filter((event) => event.type === 'sources')).toEqual([
      {
        type: 'sources',
        data: [seeded, added],
        searchQuery: '',
        searchUrl: '',
      },
    ]);
    expect(graph.getState).toHaveBeenCalledWith({
      configurable: { thread_id: 'thread-1' },
    });
  });

  it('keeps resumed sources incremental and emits an authoritative final set', async () => {
    const existing = document('https://example.test/existing');
    const replayed = document(
      'https://example.test/existing',
      'replayed object',
    );
    const newlyFound = document('https://example.test/new');
    const { driver, events } = makeHarness();
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    const result = await driver.consume(
      streamOf([
        streamEvent('on_chain_end', 'web_search', 'search-2', {
          data: {
            output: [{ update: { relevantDocuments: [replayed, newlyFound] } }],
          },
        }),
        streamEvent('on_chain_end', 'RunnableSequence', 'graph-2', {
          data: {
            output: { relevantDocuments: [replayed, newlyFound] },
          },
        }),
      ]),
      {
        kind: 'resume',
        replayedToolCallIds: new Set(['interrupted-tool']),
        existingDocuments: [existing],
      },
      graph,
    );

    expect(result.collectedDocuments).toEqual([existing, newlyFound]);
    expect(events.filter((event) => event.type === 'sources_added')).toEqual([
      {
        type: 'sources_added',
        data: [newlyFound],
        searchQuery: 'Agent Search',
        searchUrl: '',
      },
    ]);
    expect(events.filter((event) => event.type === 'sources')).toEqual([
      {
        type: 'sources',
        data: [existing, newlyFound],
        searchQuery: '',
        searchUrl: '',
      },
    ]);
  });

  it('retains distinct file-search sections that share the sentinel source', async () => {
    const firstSection = document(
      'file_search',
      'first section',
      'local query',
    );
    const secondSection = document(
      'file_search',
      'second section',
      'local query',
    );
    const { driver, events } = makeHarness();
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    const result = await driver.consume(
      streamOf([
        streamEvent('on_chain_end', 'file_search', 'file-search-1', {
          data: {
            output: { relevantDocuments: [firstSection, secondSection] },
          },
        }),
      ]),
      { kind: 'resume', replayedToolCallIds: new Set() },
      graph,
    );

    expect(result.collectedDocuments).toEqual([firstSection, secondSection]);
    expect(events.filter((event) => event.type === 'sources_added')).toEqual([
      {
        type: 'sources_added',
        data: [firstSection, secondSection],
        searchQuery: 'local query',
        searchUrl: '',
      },
    ]);
    expect(events.filter((event) => event.type === 'sources')).toEqual([
      {
        type: 'sources',
        data: [firstSection, secondSection],
        searchQuery: '',
        searchUrl: '',
      },
    ]);
  });

  it('retains file sections with identical text when their titles differ', async () => {
    const firstSection = {
      pageContent: 'shared excerpt from two files',
      metadata: {
        source: 'file_search',
        title: 'First upload',
        searchQuery: 'local query',
      },
    } as Document;
    const secondSection = {
      pageContent: 'shared excerpt from two files',
      metadata: {
        source: 'file_search',
        title: 'Second upload',
        searchQuery: 'local query',
      },
    } as Document;
    const { driver, events } = makeHarness();
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    const result = await driver.consume(
      streamOf([
        streamEvent('on_chain_end', 'file_search', 'file-search-2', {
          data: {
            output: { relevantDocuments: [firstSection, secondSection] },
          },
        }),
      ]),
      { kind: 'resume', replayedToolCallIds: new Set() },
      graph,
    );

    expect(result.collectedDocuments).toEqual([firstSection, secondSection]);
    expect(events.filter((event) => event.type === 'sources_added')).toEqual([
      {
        type: 'sources_added',
        data: [firstSection, secondSection],
        searchQuery: 'local query',
        searchUrl: '',
      },
    ]);
    expect(events.filter((event) => event.type === 'sources')).toEqual([
      {
        type: 'sources',
        data: [firstSection, secondSection],
        searchQuery: '',
        searchUrl: '',
      },
    ]);
  });

  it('retains distinct capability-doc sections sharing their citation URLs', async () => {
    const firstSection = documentWithUrl(
      'yaawc_docs',
      '/docs/capabilities/chat-and-research#web-search',
      'first capability section',
      'capability query',
    );
    const secondSection = documentWithUrl(
      'yaawc_docs',
      '/docs/capabilities/agent-capabilities#tools',
      'second capability section',
      'capability query',
    );
    const { driver, events } = makeHarness();
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    const result = await driver.consume(
      streamOf([
        streamEvent('on_chain_end', 'search_yaawc_docs', 'docs-search-1', {
          data: {
            output: { relevantDocuments: [firstSection, secondSection] },
          },
        }),
      ]),
      { kind: 'resume', replayedToolCallIds: new Set() },
      graph,
    );

    expect(result.collectedDocuments).toEqual([firstSection, secondSection]);
    expect(events.filter((event) => event.type === 'sources_added')).toEqual([
      {
        type: 'sources_added',
        data: [firstSection, secondSection],
        searchQuery: 'capability query',
        searchUrl: '',
      },
    ]);
    expect(events.filter((event) => event.type === 'sources')).toEqual([
      {
        type: 'sources',
        data: [firstSection, secondSection],
        searchQuery: '',
        searchUrl: '',
      },
    ]);
  });

  it('emits source documents from a mapping Command update even when the tool name is not search-like', async () => {
    const mappingDocument = documentWithUrl(
      'https://www.openstreetmap.org/node/910001',
      'https://www.openstreetmap.org/node/910001',
      'Central Cafe\nOpening hours: Mo-Su 08:00-18:00',
      'central cafe',
    );
    const { driver, events } = makeHarness();
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    const result = await driver.consume(
      streamOf([
        streamEvent('on_chain_end', 'get_place_details', 'details-1', {
          data: {
            output: { update: { relevantDocuments: [mappingDocument] } },
          },
        }),
      ]),
      { kind: 'resume', replayedToolCallIds: new Set() },
      graph,
    );

    expect(result.collectedDocuments).toEqual([mappingDocument]);
    expect(events).toContainEqual({
      type: 'sources_added',
      data: [mappingDocument],
      searchQuery: 'central cafe',
      searchUrl: '',
    });
    expect(events).toContainEqual({
      type: 'sources',
      data: [mappingDocument],
      searchQuery: '',
      searchUrl: '',
    });
  });

  it('uses the same response and usage fold for respond-now synthesis', async () => {
    const existing = document('https://example.test/existing');
    const { driver, events, responses, tracker } = makeHarness();

    const result = await driver.consume(
      streamOf([
        streamEvent('on_chat_model_start', 'synthesis', 'synthesis-1'),
        streamEvent('on_chat_model_stream', 'synthesis', 'synthesis-1', {
          data: { chunk: { content: 'early answer' } },
        }),
        streamEvent('on_chat_model_end', 'synthesis', 'synthesis-1', {
          data: {
            output: {
              response_metadata: { usage: usage(4, 3) },
            },
          },
        }),
      ]),
      {
        kind: 'respond-now',
        existingDocuments: [existing],
        emitFinalSources: true,
      },
    );

    expect(result.responseText).toBe('early answer');
    expect(responses).toEqual(['early answer']);
    expect(tracker.perModel()).toEqual([
      { provider: 'test', model: 'chat-model', usage: usage(4, 3) },
    ]);
    expect(events.filter((event) => event.type === 'sources')).toEqual([
      {
        type: 'sources',
        data: [existing],
        searchQuery: '',
        searchUrl: '',
      },
    ]);
  });

  it('gives newly invoked resume tools the fresh-run lifecycle and enrichment policy', () => {
    const fresh = makeHarness();
    const resumed = makeHarness();
    const freshCallbacks = toolCallbacks(fresh.driver, { kind: 'start' });
    const resumedCallbacks = toolCallbacks(resumed.driver, {
      kind: 'resume',
      replayedToolCallIds: new Set(['replayed-tool']),
      originalWidgetMappings: {},
    });
    const input = { url: 'https://youtube.test/video' };
    const output = {
      update: {
        relevantDocuments: [{ metadata: { source: 'video-123' } }],
      },
    };

    freshCallbacks.handleToolStart(
      { name: 'youtube_transcript' },
      input,
      'fresh-callback',
    );
    freshCallbacks.handleToolEnd(output, 'fresh-callback');
    resumedCallbacks.handleToolStart(
      { name: 'youtube_transcript' },
      input,
      'resume-callback',
      undefined,
      undefined,
      undefined,
      undefined,
      'new-tool-call',
    );
    resumedCallbacks.handleToolEnd(output, 'resume-callback');

    const normalize = (events: AgentEmitEvent[]) =>
      events.map((event) => {
        if (
          event.type === 'tool_call_started' ||
          event.type === 'tool_call_success' ||
          event.type === 'tool_call_error'
        ) {
          return {
            ...event,
            data: { ...event.data, toolCallId: 'callback' },
          };
        }
        return event;
      });
    expect(normalize(fresh.events)).toEqual(normalize(resumed.events));
    expect(resumed.events).toEqual([
      {
        type: 'tool_call_started',
        data: {
          toolCallId: 'resume-callback',
          toolType: 'youtube_transcript',
          status: 'running',
          attrs: { url: input.url },
        },
      },
      {
        type: 'tool_call_success',
        data: {
          toolCallId: 'resume-callback',
          status: 'success',
          extra: { videoId: 'video-123' },
        },
      },
    ]);
  });

  it('suppresses replayed tools and targets their original widgets with MCP results', () => {
    const { driver, events } = makeHarness();
    const callbacks = toolCallbacks(driver, {
      kind: 'resume',
      replayedToolCallIds: new Set(['stable-replayed']),
      originalWidgetMappings: { 'stable-replayed': 'original-widget' },
    });

    callbacks.handleToolStart(
      { name: 'mcp__server__lookup' },
      { query: 'weather' },
      'new-callback-id',
      undefined,
      undefined,
      undefined,
      undefined,
      'stable-replayed',
    );
    callbacks.handleToolEnd(
      { update: { messages: [{ content: 'MCP result' }] } },
      'new-callback-id',
    );

    expect(events).toEqual([
      {
        type: 'tool_call_success',
        data: {
          toolCallId: 'original-widget',
          status: 'success',
          extra: { mcpResult: 'MCP result' },
        },
      },
    ]);
  });

  it('enriches image-generation results for a newly invoked resume tool', () => {
    const { driver, events } = makeHarness();
    const callbacks = toolCallbacks(driver, {
      kind: 'resume',
      replayedToolCallIds: new Set(),
    });

    callbacks.handleToolStart(
      { name: 'image_generation' },
      { prompt: 'a lighthouse' },
      'image-run',
      undefined,
      undefined,
      undefined,
      undefined,
      'new-image-call',
    );
    callbacks.handleToolEnd(
      {
        update: {
          messages: [{ content: JSON.stringify({ imageId: 'image-123' }) }],
        },
      },
      'image-run',
    );

    expect(events).toEqual([
      {
        type: 'tool_call_started',
        data: {
          toolCallId: 'image-run',
          toolType: 'image_generation',
          status: 'running',
          attrs: {},
        },
      },
      {
        type: 'tool_call_success',
        data: {
          toolCallId: 'image-run',
          status: 'success',
          extra: { imageId: 'image-123' },
        },
      },
    ]);
  });

  it('summarizes explicit show_map selections without exposing private map identities', () => {
    const { driver } = makeHarness();
    const extract = (
      driver as unknown as {
        extractToolAttributes: (
          toolName: string,
          input: Record<string, unknown>,
          runId: string,
        ) => Record<string, unknown>;
      }
    ).extractToolAttributes.bind(driver);

    expect(
      extract(
        'show_map',
        {
          placeHandles: ['place_2', 'place_1'],
          routeHandle: 'route_1',
          title: 'Route and places',
        },
        'map-call',
      ),
    ).toEqual({
      query: 'places: place_2, place_1 · route: route_1',
      description: 'Route and places',
    });
    expect(
      extract(
        'show_map',
        { mapHandle: 'map_1', handle: 'map_1' },
        'legacy-map-call',
      ),
    ).toEqual({});
  });

  it('suppresses system skill and specialized tool chrome but keeps user skills visible', () => {
    const systemSkill: Skill = {
      source: 'system',
      name: 'internal-skill',
      description: '',
      content: 'internal',
      disableModelInvocation: false,
    };
    const userSkill: Skill = {
      source: 'user',
      name: 'user-skill',
      description: '',
      content: 'user',
      disableModelInvocation: false,
    };
    const { driver, events } = makeHarness({
      resolvedSkills: [systemSkill, userSkill],
    });
    const callbacks = toolCallbacks(driver, { kind: 'start' });

    callbacks.handleToolStart(
      { name: 'read_skill' },
      JSON.stringify({ name: 'internal-skill' }),
      'system-skill-run',
    );
    callbacks.handleToolEnd(
      { content: JSON.stringify({ error: 'hidden system error' }) },
      'system-skill-run',
    );
    callbacks.handleToolStart(
      { name: 'read_skill' },
      JSON.stringify({ name: 'user-skill' }),
      'user-skill-run',
    );
    callbacks.handleToolEnd({ content: 'loaded' }, 'user-skill-run');
    for (const [index, name] of [
      'deep_research',
      'todo_list',
      'create_chart',
      'show_chart',
      'show_map',
    ].entries()) {
      const runId = `specialized-run-${index}`;
      callbacks.handleToolStart({ name }, { query: 'nested work' }, runId);
      callbacks.handleToolEnd({}, runId);
    }

    expect(events).toEqual([
      {
        type: 'tool_call_started',
        data: {
          toolCallId: 'user-skill-run',
          toolType: 'read_skill',
          status: 'running',
          attrs: { query: 'user-skill' },
        },
      },
      {
        type: 'tool_call_success',
        data: {
          toolCallId: 'user-skill-run',
          status: 'success',
        },
      },
    ]);
  });

  it('extracts tool attributes, cleans correlations, and handles real errors separately from interrupts', async () => {
    const { driver, events } = makeHarness();
    const callbacks = toolCallbacks(driver, { kind: 'start' });
    const code = 'print(1)';
    const question = 'Need approval?';

    callbacks.handleToolStart(
      { name: 'code_execution' },
      { code, description: 'run it' },
      'code-1',
    );
    callbacks.handleToolStart(
      { name: 'code_execution' },
      { code, description: 'run it again' },
      'code-2',
    );
    callbacks.handleToolEnd({}, 'code-1');

    callbacks.handleToolStart(
      { name: 'ask_user' },
      { question, context: 'context' },
      'question-1',
    );
    callbacks.handleToolStart(
      { name: 'ask_user' },
      { question, context: 'context' },
      'question-2',
    );
    callbacks.handleToolError(new Error('validation failed'), 'question-1');

    callbacks.handleToolStart(
      { name: 'web_search' },
      { query: 'broken' },
      'error-run',
    );
    callbacks.handleToolError(new Error('x'.repeat(600)), 'error-run');

    callbacks.handleToolStart(
      { name: 'web_search' },
      { query: 'paused' },
      'interrupt-run',
    );
    callbacks.handleToolError(
      { name: 'GraphInterrupt', message: 'pause for approval' },
      'interrupt-run',
    );

    // The first queue entry was removed on completion/error, leaving the
    // second parallel invocation as the only correlatable one.
    const { popCallbackRunId: popCode } =
      await import('@/lib/sandbox/codeExecutionCorrelation');
    const { popCallbackRunId: popQuestion } =
      await import('@/lib/userQuestion/questionCorrelation');
    expect(popCode(code)).toBe('code-2');
    expect(popCode(code)).toBeUndefined();
    expect(popQuestion(question)).toBe('question-2');
    expect(popQuestion(question)).toBeUndefined();

    expect(events.find((event) => event.type === 'tool_call_error')).toEqual({
      type: 'tool_call_error',
      data: {
        toolCallId: 'question-1',
        status: 'error',
        error: 'validation failed',
      },
    });
    expect(
      events.find(
        (event) =>
          event.type === 'tool_call_error' &&
          event.data.toolCallId === 'error-run',
      ),
    ).toEqual({
      type: 'tool_call_error',
      data: {
        toolCallId: 'error-run',
        status: 'error',
        error: 'x'.repeat(500),
      },
    });
    expect(
      events.some(
        (event) =>
          event.type === 'tool_call_error' &&
          event.data.toolCallId === 'interrupt-run',
      ),
    ).toBe(false);
  });

  it('attributes parent model output and tools while excluding nested child runs', async () => {
    const { driver, events, responses, tracker } = makeHarness();
    const callbacks = toolCallbacks(driver, { kind: 'start' });
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    async function* syntheticStream(): AsyncGenerator<AgentStreamEvent> {
      yield streamEvent('on_chain_start', 'tools', 'parent-tools', {
        metadata: { langgraph_node: 'tools' },
      });
      callbacks.handleToolStart(
        { name: 'web_search' },
        { query: 'parent' },
        'parent-tool',
        'parent-tools',
      );
      yield streamEvent('on_tool_start', 'deep_research', 'deep-run');
      callbacks.handleToolStart(
        { name: 'web_search' },
        { query: 'child' },
        'child-tool',
        'deep-run',
      );
      yield streamEvent('on_chat_model_start', 'parent-model', 'parent-model', {
        metadata: { langgraph_node: 'model_request' },
      });
      yield streamEvent('on_chat_model_start', 'child-model', 'child-model', {
        metadata: { langgraph_node: 'model_request' },
        parent_ids: ['deep-run'],
      });
      yield streamEvent(
        'on_chat_model_stream',
        'parent-model',
        'parent-model',
        {
          metadata: { langgraph_node: 'model_request' },
          data: { chunk: { content: 'parent response' } },
        },
      );
      yield streamEvent('on_chat_model_stream', 'child-model', 'child-model', {
        metadata: { langgraph_node: 'model_request' },
        data: { chunk: { content: 'child response' } },
        parent_ids: ['deep-run'],
      });
      yield streamEvent('on_chat_model_end', 'parent-model', 'parent-model', {
        metadata: { langgraph_node: 'model_request' },
        data: { output: { usage_metadata: usage(7, 3) } },
      });
      yield streamEvent('on_chat_model_end', 'child-model', 'child-model', {
        metadata: { langgraph_node: 'model_request' },
        data: { output: { usage_metadata: usage(100, 100) } },
        parent_ids: ['deep-run'],
      });
      yield streamEvent('on_chat_model_start', 'system-model', 'system-model', {
        metadata: { langgraph_node: 'tools' },
      });
      yield streamEvent('on_chat_model_end', 'system-model', 'system-model', {
        metadata: { langgraph_node: 'tools' },
        data: { output: { usage_metadata: usage(200, 200) } },
      });
      callbacks.handleToolEnd({}, 'parent-tool');
      callbacks.handleToolEnd({}, 'child-tool');
      yield streamEvent('on_tool_end', 'deep_research', 'deep-run');
    }

    await driver.consume(syntheticStream(), { kind: 'start' }, graph);

    expect(responses).toEqual(['parent response']);
    expect(tracker.perModel()).toEqual([
      { provider: 'test', model: 'chat-model', usage: usage(7, 3) },
    ]);
    expect(
      events.filter(
        (event) =>
          event.type === 'tool_call_started' ||
          event.type === 'tool_call_success',
      ),
    ).toEqual([
      {
        type: 'tool_call_started',
        data: {
          toolCallId: 'parent-tool',
          toolType: 'web_search',
          status: 'running',
          attrs: { query: 'parent' },
        },
      },
      {
        type: 'tool_call_success',
        data: { toolCallId: 'parent-tool', status: 'success' },
      },
    ]);
  });

  it('emits an interrupt instead of final sources when the checkpoint is paused', async () => {
    const source = document('https://example.test/paused');
    const interrupt = {
      id: 'interrupt-1',
      value: {
        kind: 'ask_user' as const,
        toolCallId: 'tool-call-1',
        payload: { question: 'Continue?' },
      },
    };
    const { driver, events } = makeHarness();
    const graph = {
      getState: vi.fn(async () => ({ tasks: [{ interrupts: [interrupt] }] })),
    };

    const result = await driver.consume(
      streamOf([]),
      {
        kind: 'resume',
        replayedToolCallIds: new Set(),
        existingDocuments: [source],
      },
      graph,
    );

    expect(result.interrupted).toBe(true);
    expect(events).toContainEqual({
      type: 'interrupt',
      interrupts: [interrupt],
    });
    expect(events.some((event) => event.type === 'sources')).toBe(false);
  });

  it('derives stable replay IDs and original widget mappings before resume', async () => {
    const source = document('source');
    const graph = {
      getState: vi.fn(async () => ({
        tasks: [
          {
            interrupts: [
              { id: 'one', value: { toolCallId: 'stable-one' } },
              { id: 'two', value: { toolCallId: 'stable-one' } },
              { id: 'three', value: { toolCallId: 'stable-two' } },
            ],
          },
        ],
      })),
    };
    const { driver } = makeHarness();

    const policy = await driver.prepareResumePolicy(
      graph,
      { 'stable-one': 'widget-one' },
      [source],
    );

    expect(policy).toEqual({
      kind: 'resume',
      replayedToolCallIds: new Set(['stable-one', 'stable-two']),
      originalWidgetMappings: { 'stable-one': 'widget-one' },
      existingDocuments: [source],
    });
  });

  it.each([
    { kind: 'start' as const, policy: { kind: 'start' as const } },
    {
      kind: 'resume' as const,
      policy: {
        kind: 'resume' as const,
        replayedToolCallIds: new Set<string>(),
      },
    },
  ])(
    'makes checkpoint scan failures fatal for $kind streams',
    async ({ policy }) => {
      const { driver } = makeHarness();
      const graph = {
        getState: vi.fn(async () => {
          throw new Error('checkpoint unavailable');
        }),
      };

      await expect(
        driver.consume(streamOf([]), policy, graph),
      ).rejects.toBeInstanceOf(AgentStreamIntegrityError);
    },
  );

  it('rejects malformed checkpoint state instead of completing a run', async () => {
    const { driver } = makeHarness();
    const graph = { getState: vi.fn(async () => ({ tasks: 'not-an-array' })) };

    await expect(
      driver.consume(
        streamOf([]),
        { kind: 'resume', replayedToolCallIds: new Set() },
        graph,
      ),
    ).rejects.toBeInstanceOf(AgentStreamIntegrityError);
  });

  it('stops on the hard signal without inspecting a checkpoint or consuming later events', async () => {
    const controller = new AbortController();
    const { driver, responses } = makeHarness({ signal: controller.signal });
    const graph = { getState: vi.fn(async () => ({ tasks: [] })) };

    async function* abortingStream(): AsyncGenerator<AgentStreamEvent> {
      yield streamEvent('on_chat_model_start', 'chat', 'model-1', {
        metadata: { langgraph_node: 'model_request' },
      });
      controller.abort();
      yield streamEvent('on_chat_model_stream', 'chat', 'model-1', {
        data: { chunk: { content: 'must not be forwarded' } },
      });
    }

    const result = await driver.consume(
      abortingStream(),
      { kind: 'start' },
      graph,
    );

    expect(result.aborted).toBe(true);
    expect(responses).toEqual([]);
    expect(graph.getState).not.toHaveBeenCalled();
  });

  it('wraps ordinary stream failures with the partial result while preserving integrity errors', async () => {
    const { driver } = makeHarness();

    async function* failingStream(): AsyncGenerator<AgentStreamEvent> {
      yield streamEvent('on_chat_model_start', 'chat', 'model-1', {
        metadata: { langgraph_node: 'model_request' },
      });
      yield streamEvent('on_chat_model_stream', 'chat', 'model-1', {
        metadata: { langgraph_node: 'model_request' },
        data: { chunk: { content: 'partial' } },
      });
      throw new Error('stream broke');
    }

    try {
      await driver.consume(failingStream(), { kind: 'start' });
      throw new Error('expected consume to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentStreamExecutionError);
      expect((error as AgentStreamExecutionError).result).toMatchObject({
        responseText: 'partial',
        aborted: false,
        interrupted: false,
      });
      expect((error as AgentStreamExecutionError).cause).toBeInstanceOf(Error);
    }
  });
});
