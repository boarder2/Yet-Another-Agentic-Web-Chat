import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  workflow: vi.fn(),
  resolveWorkflowRun: vi.fn(),
  resolveChatAndEmbedding: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  execute: vi.fn(),
  update: vi.fn(),
  insertPartialAssistantRow: vi.fn(),
  updateAssistantRow: vi.fn(),
  createTurnTracker: vi.fn(),
  agentOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db', () => ({
  default: {
    query: {
      schedules: { findFirst: mocks.schedule },
      workflows: { findFirst: mocks.workflow },
    },
    insert: mocks.insert,
    update: mocks.update,
  },
}));
vi.mock('@/lib/db/schema', () => ({
  chats: { id: 'chats.id' },
  messages: {},
  schedules: { id: 'schedules.id' },
  workflows: { id: 'workflows.id' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('@/lib/workflows/resolveWorkflowRun', () => ({
  resolveWorkflowRun: mocks.resolveWorkflowRun,
}));
vi.mock('@/lib/providers/resolveModels', () => ({
  resolveChatAndEmbedding: mocks.resolveChatAndEmbedding,
}));
vi.mock('@/lib/utils/prompts', () => ({
  getPersonaInstructionsOnly: vi.fn(async () => 'persona'),
  getMethodologyInstructions: vi.fn(async () => 'methodology'),
}));
vi.mock('@/lib/db/sanitizedContent', () => ({
  computeSanitizedContent: (content: string) => content,
}));
vi.mock('@/lib/db/queries', () => ({
  insertPartialAssistantRow: mocks.insertPartialAssistantRow,
  updateAssistantRow: mocks.updateAssistantRow,
}));
vi.mock('@/lib/search/simplifiedAgent', () => ({
  SimplifiedAgent: class FakeSimplifiedAgent {
    private readonly emitter: {
      emit: (channel: string, event: unknown) => void;
    };

    constructor(options: {
      [key: string]: unknown;
      dependencies: {
        emitter: {
          emit: (channel: string, event: unknown) => void;
        };
      };
    }) {
      mocks.agentOptions.push(options);
      this.emitter = options.dependencies.emitter;
    }

    async searchAndAnswer(): Promise<void> {
      this.emitter.emit('stream_event', {
        type: 'model_stats',
        data: { version: 2, perModel: [] },
      });
      this.emitter.emit('stream_event', { type: 'agent_end' });
    }
  },
}));
vi.mock('@/lib/tokens/tracker', () => ({
  createTurnTracker: mocks.createTurnTracker,
}));
vi.mock('@/lib/widgets/envelope', () => ({
  appendWidget: (content: string) => content,
  appendChartWidget: (content: string) => content,
  updateWidget: (content: string) => content,
  neutralizeSpoofedFences: (content: string) => content,
}));
vi.mock('@/lib/chart/placement', () => ({ resolveChartPlacement: vi.fn() }));
vi.mock('@/lib/utils/contentStripping', () => ({
  stripStreamedChartTags: (content: string) => content,
}));

import { runSchedule } from './runner';

const effectiveChatRef = {
  provider: 'openai',
  name: 'gpt-5.4',
  reasoningEffort: 'low',
};
const effectiveSystemRef = {
  provider: 'anthropic',
  name: 'claude-opus-4-6',
  reasoningEffort: 'medium',
};

describe('scheduled effective model routing', () => {
  it('uses resolved effort refs in the run snapshot and assistant audit metadata', async () => {
    mocks.schedule.mockResolvedValue({
      id: 'schedule-1',
      enabled: 1,
      workflowId: 'workflow-1',
      label: 'Daily report',
      inputValues: {},
    });
    mocks.workflow.mockResolvedValue({ id: 'workflow-1' });
    mocks.resolveWorkflowRun.mockReturnValue({
      composedQuery: 'Research durable runtime',
      focusMode: 'webSearch',
      chatModel: {
        provider: 'openai',
        name: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      systemModel: null,
      selectedSystemPromptIds: [],
      selectedMethodologyId: null,
    });
    mocks.resolveChatAndEmbedding.mockResolvedValue({
      chatLlm: {},
      systemLlm: {},
      embedding: {},
      chatModelRef: effectiveChatRef,
      systemModelRef: effectiveSystemRef,
    });
    mocks.values.mockReturnValue({ execute: mocks.execute });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ execute: mocks.execute })),
      })),
    });
    mocks.execute.mockResolvedValue(undefined);
    mocks.insertPartialAssistantRow.mockResolvedValue(undefined);
    mocks.updateAssistantRow.mockResolvedValue(undefined);
    mocks.createTurnTracker.mockReturnValue({
      tracker: {},
      chatRecorder: {},
      systemRecorder: {},
    });
    mocks.agentOptions.length = 0;

    const result = await runSchedule('schedule-1');

    expect(result.status).toBe('success');
    expect(mocks.createTurnTracker).toHaveBeenCalledWith(
      expect.anything(),
      effectiveChatRef,
      effectiveSystemRef,
    );
    expect(mocks.agentOptions[0]?.run).toMatchObject({
      version: 2,
      chatModelRef: effectiveChatRef,
      systemModelRef: effectiveSystemRef,
    });

    const assistantUpdate = mocks.updateAssistantRow.mock.calls.find((call) =>
      Boolean(
        (call[1] as { metadata?: Record<string, unknown> })?.metadata
          ?.modelConfig,
      ),
    )?.[1] as { metadata: Record<string, unknown> } | undefined;
    expect(assistantUpdate?.metadata).toMatchObject({
      modelConfig: {
        chat: effectiveChatRef,
        system: effectiveSystemRef,
      },
      modelStats: { version: 2, perModel: [] },
    });
  });
});
