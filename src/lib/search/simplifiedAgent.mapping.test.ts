import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { TokenTracker } from '@/lib/tokens/tracker';
import {
  allAgentTools,
  getMappingTools,
  MAPPING_TOOL_NAMES,
} from '@/lib/tools/agents';
import { createAgentRunConfig, type AgentRunConfig } from './agentRunConfig';

const createAgentMock = vi.hoisted(() =>
  vi.fn((options: unknown) => ({ options })),
);

vi.mock('langchain', async () => {
  const actual = await vi.importActual<typeof import('langchain')>('langchain');
  return { ...actual, createAgent: createAgentMock };
});

vi.mock('@/lib/skills/resolve', () => ({
  resolveSkillsForChat: vi.fn(async () => []),
}));

vi.mock('@/lib/runs/checkpointer', () => ({
  getLanggraphCheckpointer: vi.fn(() => ({})),
}));

import { SimplifiedAgent } from './simplifiedAgent';

type ToolLike = { name: string };
type AgentInternals = {
  getToolsForFocusMode: (focusMode: string, fileIds?: string[]) => ToolLike[];
  initializeAgent: (
    focusMode: string,
    fileIds?: string[],
    messagesCount?: number,
    query?: string,
    firefoxAIDetected?: boolean,
    customTools?: typeof allAgentTools,
    customSystemPrompt?: string,
    extraTools?: unknown[],
  ) => Promise<unknown>;
};

const baseInput = () => ({
  chatModelRef: { provider: 'test', name: 'chat' },
  systemModelRef: { provider: 'test', name: 'system' },
  focusMode: 'webSearch',
  fileIds: [],
  personaInstructions: '',
  methodologyInstructions: '',
  userLocation: null,
  userProfile: null,
  workspaceId: null,
  isPrivate: false,
  chatId: 'chat-1',
  messageId: 'message-1',
  aiMessageId: 'assistant-1',
  interactiveSession: true,
  workspaceSuffix: '',
  memoryEnabled: false,
  panel: null,
  mappingAvailable: false,
  mappingSavedLocationEnabled: false,
});

const makeRun = (overrides: Partial<AgentRunConfig> = {}): AgentRunConfig =>
  createAgentRunConfig({ ...baseInput(), ...overrides });

const makeAgent = (overrides: Partial<AgentRunConfig> = {}) => {
  const emitter = new EventEmitter();
  const tracker = new TokenTracker(emitter);
  const chatRecorder = tracker.register({
    provider: 'test',
    model: 'chat',
    role: 'chat',
  });
  const systemRecorder = tracker.register({
    provider: 'test',
    model: 'system',
    role: 'system',
  });
  const agent = new SimplifiedAgent({
    dependencies: {
      chatLlm: {} as BaseChatModel,
      systemLlm: {} as BaseChatModel,
      embeddings: {} as CachedEmbeddings,
      emitter,
      tokenTracking: { tracker, chatRecorder, systemRecorder },
    },
    run: makeRun(overrides),
    context: { signal: new AbortController().signal },
  });
  return {
    agent,
    internals: agent as unknown as AgentInternals,
  };
};

const names = (tools: readonly ToolLike[]) => tools.map((tool) => tool.name);

const panel = {
  executors: [
    { provider: 'test', name: 'executor-a' },
    { provider: 'test', name: 'executor-b' },
  ],
};

describe('SimplifiedAgent mapping tool gating', () => {
  it('adds mapping tools only to an enabled ordinary interactive Web Search turn', () => {
    const eligible = makeAgent({ mappingAvailable: true });
    expect(names(eligible.internals.getToolsForFocusMode('webSearch'))).toEqual(
      expect.arrayContaining(MAPPING_TOOL_NAMES),
    );

    const excludedCases: Array<{
      name: string;
      run: Partial<AgentRunConfig>;
      focusMode: string;
    }> = [
      {
        name: 'disabled mapping',
        run: { mappingAvailable: false },
        focusMode: 'webSearch',
      },
      {
        name: 'Chat focus',
        run: { mappingAvailable: true },
        focusMode: 'chat',
      },
      {
        name: 'Local Research focus',
        run: { mappingAvailable: true },
        focusMode: 'localResearch',
      },
      {
        name: 'panel execution',
        run: { mappingAvailable: true, panel },
        focusMode: 'webSearch',
      },
      {
        name: 'non-interactive execution',
        run: {
          mappingAvailable: true,
          interactiveSession: false,
          chatId: null,
          messageId: null,
          aiMessageId: null,
        },
        focusMode: 'webSearch',
      },
      {
        name: 'unknown focus fallback',
        run: { mappingAvailable: true },
        focusMode: 'unknown-focus',
      },
    ];

    for (const testCase of excludedCases) {
      const candidate = makeAgent(testCase.run);
      expect(
        names(candidate.internals.getToolsForFocusMode(testCase.focusMode)),
        testCase.name,
      ).not.toEqual(expect.arrayContaining(MAPPING_TOOL_NAMES));
    }
  });

  it('allows mapping in an enabled private Web Search turn without enabling artifacts', () => {
    const { internals } = makeAgent({
      mappingAvailable: true,
      isPrivate: true,
    });
    const toolNames = names(internals.getToolsForFocusMode('webSearch'));

    expect(toolNames).toEqual(expect.arrayContaining(MAPPING_TOOL_NAMES));
    expect(toolNames).not.toContain('create_artifact');
    expect(toolNames).not.toContain('edit_artifact');
    expect(toolNames).not.toContain('read_artifact');
  });

  it('removes mapping tools from explicit custom and Firefox-restricted tool surfaces', async () => {
    createAgentMock.mockClear();
    const { internals } = makeAgent({
      mappingAvailable: true,
      interactiveSession: false,
      chatId: null,
      messageId: null,
      aiMessageId: null,
    });
    const customMappingTools =
      getMappingTools() as unknown as typeof allAgentTools;

    await internals.initializeAgent(
      'webSearch',
      [],
      undefined,
      undefined,
      undefined,
      customMappingTools,
    );
    const customOptions = createAgentMock.mock.calls.at(-1)?.[0] as {
      tools: ToolLike[];
    };
    expect(names(customOptions.tools)).not.toEqual(
      expect.arrayContaining(MAPPING_TOOL_NAMES),
    );

    await internals.initializeAgent(
      'webSearch',
      [],
      1,
      "I'm on page <selection>map this</selection>",
      true,
    );
    const firefoxOptions = createAgentMock.mock.calls.at(-1)?.[0] as {
      tools: ToolLike[];
      systemPrompt: string;
    };
    expect(names(firefoxOptions.tools)).toEqual(['search_yaawc_docs']);
    expect(names(firefoxOptions.tools)).not.toEqual(
      expect.arrayContaining(MAPPING_TOOL_NAMES),
    );
    expect(firefoxOptions.systemPrompt).not.toContain(
      '## Mapping and location-grounded answers',
    );
  });
});
