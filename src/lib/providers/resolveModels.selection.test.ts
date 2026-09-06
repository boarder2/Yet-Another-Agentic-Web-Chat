import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const mocks = vi.hoisted(() => ({
  getAvailableChatModelProviders: vi.fn(),
  getAvailableEmbeddingModelProviders: vi.fn(),
  getEmbeddingModelSelection: vi.fn(),
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

const chat = (label: string) => ({ label }) as unknown as BaseChatModel;

const chatCatalog = () => ({
  openai: {
    'fallback-model': {
      displayName: 'Fallback model',
      model: chat('fallback'),
    },
  },
  'openai-compatible:provider-id': {
    'local-model': { displayName: 'Local model', model: chat('local') },
  },
});

const embeddingCatalog = () => ({
  openai: {
    'text-embedding': { displayName: 'Embedding', model: {} },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmbeddingModelSelection.mockReturnValue({ provider: '', name: '' });
  mocks.getAvailableChatModelProviders.mockResolvedValue(chatCatalog());
  mocks.getAvailableEmbeddingModelProviders.mockResolvedValue(
    embeddingCatalog(),
  );
});

describe('model selection presence and stale references', () => {
  it('returns null for an explicit unavailable reference instead of selecting the first model', async () => {
    await expect(
      resolveModelRef({
        provider: 'openai-compatible:provider-id',
        name: 'deleted-model',
      }),
    ).resolves.toBeNull();
  });

  it('uses the first available models only when Chat and embedding selections are absent', async () => {
    const resolved = await resolveChatAndEmbedding({});

    expect(resolved.chatModelRef).toEqual({
      provider: 'openai',
      name: 'fallback-model',
    });
    expect(resolved.systemModelRef).toEqual(resolved.chatModelRef);
    expect(resolved.embedding).toMatchObject({
      provider: 'openai',
      name: 'text-embedding',
    });
  });

  it('rejects an explicit stale Chat reference even when another model is available', async () => {
    await expect(
      resolveChatAndEmbedding({
        chatModel: {
          provider: 'openai-compatible:provider-id',
          name: 'deleted-model',
        },
      }),
    ).rejects.toThrow('Invalid chat model');
  });

  it('rejects an explicit stale System reference instead of falling back to Chat', async () => {
    await expect(
      resolveChatAndEmbedding({
        chatModel: {
          provider: 'openai-compatible:provider-id',
          name: 'local-model',
        },
        systemModel: {
          provider: 'openai-compatible:provider-id',
          name: 'disabled-model',
        },
      }),
    ).rejects.toThrow('Invalid system model');
  });

  it('rejects an explicit stale embedding selection instead of using the first embedding model', async () => {
    mocks.getEmbeddingModelSelection.mockReturnValue({
      provider: 'openai',
      name: 'deleted-embedding',
    });

    await expect(
      resolveChatAndEmbedding({
        chatModel: {
          provider: 'openai-compatible:provider-id',
          name: 'local-model',
        },
      }),
    ).rejects.toThrow('Invalid embedding model');
  });

  it('treats a partial persisted embedding selection as explicit and invalid', async () => {
    mocks.getEmbeddingModelSelection.mockReturnValue({
      provider: 'openai',
      name: '',
    });

    await expect(resolveChatAndEmbedding({})).rejects.toThrow(
      'Invalid embedding model',
    );
  });
});
