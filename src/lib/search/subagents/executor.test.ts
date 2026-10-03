import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import type { TokenTracker } from '@/lib/tokens/tracker';
import type { SubagentDefinition } from './definitions';

const mocks = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  prompts: [] as string[],
  register: vi.fn(() => ({ record: vi.fn() })),
  scopeUsage: vi.fn(() => undefined),
}));

vi.mock('@/lib/search/simplifiedAgent', () => ({
  SimplifiedAgent: class FakeSimplifiedAgent {
    constructor(options: { run: Record<string, unknown> }) {
      mocks.runs.push(options.run);
    }

    async searchAndAnswer(input: {
      customSystemPrompt: string;
    }): Promise<void> {
      mocks.prompts.push(input.customSystemPrompt);
    }
  },
}));
vi.mock('@/lib/tools/agents', () => ({
  allAgentTools: [],
  CHART_TOOL_NAMES: [],
}));
vi.mock('@/lib/tools/agents/artifactTools', () => ({
  ARTIFACT_TOOL_NAMES: [],
}));

import { SubagentExecutor } from './executor';

const CLOCK = { now: '2026-10-03T12:00:00Z', timeZone: 'America/Chicago' };

const definition: SubagentDefinition = {
  name: 'Research child',
  description: 'A test child',
  systemPrompt: 'Research the task.',
  allowedTools: [],
  useSystemModel: false,
  maxTurns: 1,
  parallelizable: true,
};

describe('SubagentExecutor reasoning routing', () => {
  it('carries independent Chat/System effort into the child run snapshot', async () => {
    mocks.runs.length = 0;
    mocks.register.mockClear();
    const tracker = {
      register: mocks.register,
      scopeUsage: mocks.scopeUsage,
    } as unknown as TokenTracker;
    const parent = new EventEmitter();

    const result = await new SubagentExecutor(
      definition,
      {} as never,
      {} as never,
      {} as CachedEmbeddings,
      parent,
      new AbortController().signal,
      'parent-message',
      undefined,
      undefined,
      undefined,
      CLOCK,
      tracker,
      { provider: 'openai', model: 'gpt-5.4', reasoningEffort: 'high' },
      {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        reasoningEffort: 'low',
      },
    ).execute('investigate this', [], []);

    expect(result.status).toBe('success');
    expect(mocks.runs).toHaveLength(1);
    expect(mocks.prompts[0]).toContain(
      "Today's Date: Saturday, October 3, 2026 (America/Chicago)",
    );
    expect(mocks.runs[0]).toMatchObject({
      clock: CLOCK,
      chatModelRef: {
        provider: 'openai',
        name: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      systemModelRef: {
        provider: 'anthropic',
        name: 'claude-opus-4-6',
        reasoningEffort: 'low',
      },
    });
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        role: 'chat',
      }),
    );
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        reasoningEffort: 'low',
        role: 'system',
      }),
    );
  });
});
