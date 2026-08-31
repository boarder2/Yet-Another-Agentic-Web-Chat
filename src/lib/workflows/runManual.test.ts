import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvedWorkflowRun: vi.fn(),
  resolveChatAndEmbedding: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  execute: vi.fn(),
  createTurnTracker: vi.fn(),
  startRun: vi.fn(),
  attachRunHost: vi.fn(),
  agentOptions: [] as Array<Record<string, unknown>>,
  searchAndAnswer: vi.fn(),
}));

vi.mock('@/lib/workflows/resolveWorkflowRun', () => ({
  resolveWorkflowRun: mocks.resolvedWorkflowRun,
}));
vi.mock('@/lib/providers/resolveModels', () => ({
  resolveChatAndEmbedding: mocks.resolveChatAndEmbedding,
}));
vi.mock('@/lib/db', () => ({ default: { insert: mocks.insert } }));
vi.mock('@/lib/db/schema', () => ({ chats: {}, messages: {} }));
vi.mock('@/lib/db/sanitizedContent', () => ({
  computeSanitizedContent: (content: string) => content,
}));
vi.mock('@/lib/utils/prompts', () => ({
  getPersonaInstructionsOnly: vi.fn(async () => 'persona'),
  getMethodologyInstructions: vi.fn(async () => 'methodology'),
}));
vi.mock('@/lib/search/simplifiedAgent', () => ({
  SimplifiedAgent: class FakeSimplifiedAgent {
    constructor(options: { [key: string]: unknown }) {
      mocks.agentOptions.push(options);
    }

    searchAndAnswer = mocks.searchAndAnswer;
  },
}));
vi.mock('@/lib/tokens/tracker', () => ({
  createTurnTracker: mocks.createTurnTracker,
}));
vi.mock('@/lib/settings/server', () => ({
  getSettings: vi.fn(() => ({})),
  getBooleanSetting: vi.fn(() => true),
}));
vi.mock('@/lib/runs/runHub', () => ({
  startRun: mocks.startRun,
  evictByChatId: vi.fn(),
}));
vi.mock('@/lib/runs/runHost', () => ({ attachRunHost: mocks.attachRunHost }));

import { startWorkflowRun } from './runManual';

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

describe('manual workflow effective model routing', () => {
  it('snapshots resolver-effective effort instead of the workflow source value', async () => {
    mocks.resolvedWorkflowRun.mockReturnValue({
      composedQuery: 'Research durable runtime',
      focusMode: 'webSearch',
      chatModel: {
        provider: 'openai',
        name: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      systemModel: {
        provider: 'anthropic',
        name: 'claude-opus-4-6',
        reasoningEffort: 'high',
      },
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
    mocks.execute.mockResolvedValue(undefined);
    mocks.createTurnTracker.mockReturnValue({
      tracker: {},
      chatRecorder: {},
      systemRecorder: {},
    });
    mocks.startRun.mockReturnValue({ run: {}, isNew: true });
    mocks.attachRunHost.mockResolvedValue(undefined);
    mocks.searchAndAnswer.mockResolvedValue(undefined);
    mocks.agentOptions.length = 0;

    const result = await startWorkflowRun({ id: 'workflow-1' } as never, {});

    expect(result.chatId).toEqual(expect.any(String));
    expect(mocks.createTurnTracker).toHaveBeenCalledWith(
      expect.anything(),
      effectiveChatRef,
      effectiveSystemRef,
    );
    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        configSnapshot: expect.objectContaining({
          version: 2,
          chatModelRef: effectiveChatRef,
          systemModelRef: effectiveSystemRef,
        }),
      }),
    );
    expect(mocks.attachRunHost).toHaveBeenCalledWith(
      expect.objectContaining({
        configSnapshot: expect.objectContaining({
          chatModelRef: effectiveChatRef,
          systemModelRef: effectiveSystemRef,
        }),
      }),
    );
  });
});
