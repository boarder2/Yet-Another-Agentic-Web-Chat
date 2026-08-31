import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const chatCache = new Map<string, unknown>();
  const embeddingCache = new Map<string, unknown>();

  return {
    chatCache,
    embeddingCache,
    getCachedChatModels: vi.fn(
      (provider: string) => chatCache.get(provider) ?? null,
    ),
    setCachedChatModels: vi.fn((provider: string, value: unknown) => {
      chatCache.set(provider, value);
    }),
    getCachedEmbeddingModels: vi.fn(
      (provider: string) => embeddingCache.get(provider) ?? null,
    ),
    setCachedEmbeddingModels: vi.fn((provider: string, value: unknown) => {
      embeddingCache.set(provider, value);
    }),
    loadOpenAIChatModels: vi.fn(async () => ({})),
    loadOpenAIEmbeddingModels: vi.fn(async () => ({})),
    loadAnthropicChatModels: vi.fn(async () => ({})),
    loadGeminiChatModels: vi.fn(async () => ({})),
    loadGeminiEmbeddingModels: vi.fn(async () => ({})),
    loadDeepseekChatModels: vi.fn(async () => ({})),
    loadLMStudioChatModels: vi.fn(async () => ({})),
    loadLMStudioEmbeddingsModels: vi.fn(async () => ({})),
    loadTransformersEmbeddingsModels: vi.fn(async () => ({})),
    loadOpenrouterChatModels: vi.fn(async () => ({})),
    loadTestChatModels: vi.fn(async () => ({})),
    loadTestEmbeddingModels: vi.fn(async () => ({})),
    getOpenaiApiKey: vi.fn(() => ''),
    getCustomOpenaiApiKey: vi.fn(() => ''),
    getCustomOpenaiApiUrl: vi.fn(() => ''),
    getCustomOpenaiModelName: vi.fn(() => ''),
    getHiddenModels: vi.fn(() => []),
  };
});

vi.mock('./openai', () => ({
  loadOpenAIChatModels: mocks.loadOpenAIChatModels,
  loadOpenAIEmbeddingModels: mocks.loadOpenAIEmbeddingModels,
}));
vi.mock('./anthropic', () => ({
  loadAnthropicChatModels: mocks.loadAnthropicChatModels,
}));
vi.mock('./gemini', () => ({
  loadGeminiChatModels: mocks.loadGeminiChatModels,
  loadGeminiEmbeddingModels: mocks.loadGeminiEmbeddingModels,
}));
vi.mock('./deepseek', () => ({
  loadDeepseekChatModels: mocks.loadDeepseekChatModels,
}));
vi.mock('./lmstudio', () => ({
  loadLMStudioChatModels: mocks.loadLMStudioChatModels,
  loadLMStudioEmbeddingsModels: mocks.loadLMStudioEmbeddingsModels,
}));
vi.mock('./transformers', () => ({
  loadTransformersEmbeddingsModels: mocks.loadTransformersEmbeddingsModels,
}));
vi.mock('./openrouter', () => ({
  loadOpenrouterChatModels: mocks.loadOpenrouterChatModels,
}));
vi.mock('./test', () => ({
  loadTestChatModels: mocks.loadTestChatModels,
  loadTestEmbeddingModels: mocks.loadTestEmbeddingModels,
}));
vi.mock('./modelCache', () => ({
  getCachedChatModels: mocks.getCachedChatModels,
  setCachedChatModels: mocks.setCachedChatModels,
  getCachedEmbeddingModels: mocks.getCachedEmbeddingModels,
  setCachedEmbeddingModels: mocks.setCachedEmbeddingModels,
  NEGATIVE_CACHE_TTL_MS: 60_000,
}));
vi.mock('../config', () => ({
  getOpenaiApiKey: mocks.getOpenaiApiKey,
  getCustomOpenaiApiKey: mocks.getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl: mocks.getCustomOpenaiApiUrl,
  getCustomOpenaiModelName: mocks.getCustomOpenaiModelName,
}));
vi.mock('@/lib/settings/server', () => ({
  getHiddenModels: mocks.getHiddenModels,
}));

import {
  chatModelProviders,
  embeddingModelProviders,
  getAvailableChatModelProviders,
  PROVIDER_METADATA,
} from './index';

describe('chat model capability cache and refresh', () => {
  it('does not register retired providers in discovery or metadata', () => {
    expect(chatModelProviders).not.toHaveProperty('groq');
    expect(chatModelProviders).not.toHaveProperty('aimlapi');
    expect(embeddingModelProviders).not.toHaveProperty('aimlapi');
    expect(PROVIDER_METADATA).not.toHaveProperty('groq');
    expect(PROVIDER_METADATA).not.toHaveProperty('aimlapi');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatCache.clear();
    mocks.embeddingCache.clear();
    mocks.loadOpenAIChatModels.mockResolvedValue({
      'gpt-5.4': {
        displayName: 'GPT-5.4',
        model: {},
        supportedReasoningEfforts: ['off', 'high'],
      },
    });
  });

  it('retains capability metadata in cached catalogs and refreshes it on demand', async () => {
    const first = await getAvailableChatModelProviders();
    expect(first.openai['gpt-5.4'].supportedReasoningEfforts).toEqual([
      'off',
      'high',
    ]);
    expect(mocks.loadOpenAIChatModels).toHaveBeenCalledTimes(1);

    const cached = await getAvailableChatModelProviders();
    expect(cached.openai['gpt-5.4'].supportedReasoningEfforts).toEqual([
      'off',
      'high',
    ]);
    expect(mocks.loadOpenAIChatModels).toHaveBeenCalledTimes(1);

    mocks.loadOpenAIChatModels.mockResolvedValueOnce({
      'gpt-5.4': {
        displayName: 'GPT-5.4',
        model: {},
        supportedReasoningEfforts: ['off', 'low', 'medium', 'high'],
      },
    });

    const refreshed = await getAvailableChatModelProviders({
      forceRefresh: true,
    });
    expect(refreshed.openai['gpt-5.4'].supportedReasoningEfforts).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
    expect(mocks.loadOpenAIChatModels).toHaveBeenCalledTimes(2);
  });
});
