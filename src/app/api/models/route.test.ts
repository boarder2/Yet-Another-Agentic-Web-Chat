import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAvailableChatModelProviders: vi.fn(),
  getAvailableEmbeddingModelProviders: vi.fn(),
  getAvailableImageGenerationModels: vi.fn(),
}));

vi.mock('@/lib/providers', () => ({
  getAvailableChatModelProviders: mocks.getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders:
    mocks.getAvailableEmbeddingModelProviders,
}));
vi.mock('@/lib/providers/imageGenerationModels', () => ({
  getAvailableImageGenerationModels: mocks.getAvailableImageGenerationModels,
}));

import { GET } from './route';

const get = (url = 'http://localhost/api/models') => GET(new Request(url));

describe('GET /api/models reasoning capability serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      openai: {
        'gpt-5.4': {
          displayName: 'GPT-5.4',
          model: {},
          supportedReasoningEfforts: ['off', 'high'],
        },
        'gpt-4o': {
          displayName: 'GPT-4o',
          model: {},
        },
      },
    });
    mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({
      openai: {
        'text-embedding-3-small': {
          displayName: 'Embedding',
          model: {},
        },
      },
    });
    mocks.getAvailableImageGenerationModels.mockResolvedValue({});
  });

  it('serializes supported levels while omitting capability metadata for unsupported models', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      chatModelProviders: {
        openai: {
          'gpt-5.4': {
            displayName: 'GPT-5.4',
            supportedReasoningEfforts: ['off', 'high'],
          },
          'gpt-4o': { displayName: 'GPT-4o' },
        },
      },
      embeddingModelProviders: {
        openai: { 'text-embedding-3-small': { displayName: 'Embedding' } },
      },
      imageGenerationModels: {},
    });
  });

  it('serializes capability levels and forwards refresh and visibility options', async () => {
    const levels = ['low', 'medium'] as const;
    mocks.getAvailableChatModelProviders.mockResolvedValueOnce({
      provider: {
        model: {
          displayName: 'Model',
          model: {},
          supportedReasoningEfforts: levels,
        },
      },
    });

    const response = await get(
      'http://localhost/api/models?refresh=true&include_hidden=true',
    );
    const body = await response.json();

    expect(
      body.chatModelProviders.provider.model.supportedReasoningEfforts,
    ).toEqual(['low', 'medium']);
    expect(mocks.getAvailableChatModelProviders).toHaveBeenCalledWith({
      includeHidden: true,
      forceRefresh: true,
    });
    expect(mocks.getAvailableEmbeddingModelProviders).toHaveBeenCalledWith({
      includeHidden: true,
      forceRefresh: true,
    });
    expect(mocks.getAvailableImageGenerationModels).toHaveBeenCalledWith({
      forceRefresh: true,
    });
  });
});
