import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAvailableChatModelProviders: vi.fn(),
  getAvailableEmbeddingModelProviders: vi.fn(),
  getEmbeddingModelSelection: vi.fn(() => ({ provider: '', name: '' })),
}));

vi.mock('@/lib/providers', () => ({
  getAvailableChatModelProviders: mocks.getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders:
    mocks.getAvailableEmbeddingModelProviders,
}));
vi.mock('@/lib/settings/server', () => ({
  getEmbeddingModelSelection: mocks.getEmbeddingModelSelection,
}));
vi.mock('@/lib/models/presets', () => ({ DEFAULT_CONTEXT_WINDOW: 32768 }));
vi.mock('@/lib/utils/cachedEmbeddings', () => ({
  CachedEmbeddings: class {
    constructor(
      readonly model: unknown,
      readonly provider: string,
      readonly name: string,
    ) {}
  },
}));

import { resolveChatAndEmbedding, resolveModelRef } from './resolveModels';

type InvocationModel = BaseChatModel & {
  invocationParams(options: Record<string, unknown>): Record<string, unknown>;
};

const invocationParams = (model: BaseChatModel) =>
  (model as InvocationModel).invocationParams({});

const catalogEntry = (
  model: BaseChatModel,
  supportedReasoningEfforts?: string[],
) =>
  ({
    displayName: 'Catalog model',
    model,
    ...(supportedReasoningEfforts ? { supportedReasoningEfforts } : {}),
  }) as never;

describe('reasoning effort model-reference resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAvailableChatModelProviders.mockReset();
    mocks.getAvailableEmbeddingModelProviders.mockReset();
    mocks.getEmbeddingModelSelection.mockReturnValue({
      provider: '',
      name: '',
    });
  });

  it('clamps stale effort to live capabilities on a private model copy', async () => {
    const cached = new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-5.4',
      modelKwargs: { existing: 'value' },
    }) as unknown as BaseChatModel;
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      openai: {
        'gpt-5.4': catalogEntry(cached, ['low', 'high']),
      },
    });

    const resolved = await resolveModelRef({
      provider: 'openai',
      name: 'gpt-5.4',
      reasoningEffort: 'medium',
    });

    expect(resolved).not.toBeNull();
    expect(resolved).not.toBe(cached);
    expect(invocationParams(resolved!).reasoning_effort).toBe('low');
    expect(invocationParams(cached).reasoning_effort).toBeUndefined();
    expect(
      (cached as unknown as { modelKwargs: Record<string, unknown> })
        .modelKwargs,
    ).toEqual({ existing: 'value' });
  });

  it('keeps Provider default for an unprofiled catalog model', async () => {
    const cached = new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-4o',
    }) as unknown as BaseChatModel;
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      openai: {
        'gpt-4o': catalogEntry(cached),
      },
    });

    const resolved = await resolveModelRef({
      provider: 'openai',
      name: 'gpt-4o',
      reasoningEffort: 'high',
    });

    expect(resolved).toBe(cached);
    expect(invocationParams(resolved!).reasoning_effort).toBeUndefined();
  });

  it('inherits the complete chat configuration when system falls back to chat', async () => {
    const chat = new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-5.4',
    }) as unknown as BaseChatModel;
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      openai: {
        'gpt-5.4': catalogEntry(chat, [
          'off',
          'low',
          'medium',
          'high',
          'xhigh',
        ]),
      },
    });
    mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({
      openai: {
        'text-embedding': {
          displayName: 'Embedding',
          model: {},
        },
      },
    });

    const resolved = await resolveChatAndEmbedding({
      chatModel: {
        provider: 'openai',
        name: 'gpt-5.4',
        contextWindowSize: 8192,
        reasoningEffort: 'high',
      },
    });

    expect(resolved.systemLlm).toBe(resolved.chatLlm);
    expect(invocationParams(resolved.systemLlm).reasoning_effort).toBe('high');
    expect(resolved.chatModelRef).toEqual({
      provider: 'openai',
      name: 'gpt-5.4',
      contextWindowSize: 8192,
      reasoningEffort: 'high',
    });
    expect(resolved.systemModelRef).toEqual(resolved.chatModelRef);
  });

  it('resolves Chat and System effort independently and returns effective refs', async () => {
    const chat = new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-5.4',
    }) as unknown as BaseChatModel;
    const system = new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-5.1',
    }) as unknown as BaseChatModel;
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      openai: {
        'gpt-5.4': catalogEntry(chat, ['low', 'high']),
        'gpt-5.1': catalogEntry(system, ['off', 'medium', 'high']),
      },
    });
    mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({
      openai: {
        'text-embedding': {
          displayName: 'Embedding',
          model: {},
        },
      },
    });

    const resolved = await resolveChatAndEmbedding({
      chatModel: {
        provider: 'openai',
        name: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
      systemModel: {
        provider: 'openai',
        name: 'gpt-5.1',
        reasoningEffort: 'high',
      },
    });

    expect(resolved.chatModelRef).toMatchObject({
      provider: 'openai',
      name: 'gpt-5.4',
      reasoningEffort: 'low',
    });
    expect(resolved.systemModelRef).toMatchObject({
      provider: 'openai',
      name: 'gpt-5.1',
      reasoningEffort: 'high',
    });
    expect(invocationParams(resolved.chatLlm).reasoning_effort).toBe('low');
    expect(invocationParams(resolved.systemLlm).reasoning_effort).toBe('high');
  });

  it('preserves a snapshotted effort on resume instead of re-clamping live metadata', async () => {
    const cached = new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-5.4',
    }) as unknown as BaseChatModel;
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      openai: {
        'gpt-5.4': catalogEntry(cached, ['low']),
      },
    });
    mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({
      openai: {
        'text-embedding': {
          displayName: 'Embedding',
          model: {},
        },
      },
    });

    const resolved = await resolveChatAndEmbedding({
      chatModel: {
        provider: 'openai',
        name: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      preserveEffort: true,
    });

    expect(resolved.chatModelRef.reasoningEffort).toBe('high');
    expect(invocationParams(resolved.chatLlm).reasoning_effort).toBe('high');
  });

  it('rejects malformed effort before consulting the model catalog', async () => {
    await expect(
      resolveModelRef({
        provider: 'openai',
        name: 'gpt-5.4',
        reasoningEffort: 'invalid' as never,
      }),
    ).rejects.toThrow(/Invalid reasoning effort/);
    expect(mocks.getAvailableChatModelProviders).not.toHaveBeenCalled();
  });
});
