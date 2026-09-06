import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenAICompatibleProviderRow } from './openaiCompatible/types';

type DiscoveryDescriptor = { id: string; name?: string };

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
    loadTransformersEmbeddingsModels: vi.fn(async () => ({})),
    loadOpenrouterChatModels: vi.fn(async () => ({})),
    loadTestChatModels: vi.fn(async () => ({})),
    loadTestEmbeddingModels: vi.fn(async () => ({})),
    listEnabledOpenAICompatibleProviders: vi.fn(
      async () => [] as OpenAICompatibleProviderRow[],
    ),
    listOpenAICompatibleProviders: vi.fn(
      async () => [] as OpenAICompatibleProviderRow[],
    ),
    discoverOpenAICompatibleModels: vi.fn(
      async (_provider: OpenAICompatibleProviderRow) =>
        [] as DiscoveryDescriptor[],
    ),
    createOpenAICompatibleChatModel: vi.fn(
      (provider: OpenAICompatibleProviderRow, model: string): unknown => ({
        kind: 'chat',
        provider: provider.id,
        model,
      }),
    ),
    createOpenAICompatibleEmbeddingModel: vi.fn(
      (provider: OpenAICompatibleProviderRow, model: string): unknown => ({
        kind: 'embedding',
        provider: provider.id,
        model,
      }),
    ),
    getHiddenModels: vi.fn(
      () => [] as (string | { provider: string; model: string })[],
    ),
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
vi.mock('./openaiCompatible/store', () => ({
  listEnabledOpenAICompatibleProviders:
    mocks.listEnabledOpenAICompatibleProviders,
  listOpenAICompatibleProviders: mocks.listOpenAICompatibleProviders,
}));
vi.mock('./openaiCompatible/client', () => ({
  discoverOpenAICompatibleModels: mocks.discoverOpenAICompatibleModels,
  createOpenAICompatibleChatModel: mocks.createOpenAICompatibleChatModel,
  createOpenAICompatibleEmbeddingModel:
    mocks.createOpenAICompatibleEmbeddingModel,
}));
vi.mock('@/lib/settings/server', () => ({
  getHiddenModels: mocks.getHiddenModels,
}));

import {
  chatModelProviders,
  embeddingModelProviders,
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
  getAvailableProviderMetadata,
  PROVIDER_METADATA,
} from './index';

const provider = (
  id: string,
  name: string,
  overrides: Partial<OpenAICompatibleProviderRow> = {},
): OpenAICompatibleProviderRow =>
  ({
    id,
    name,
    normalizedName: name.toLowerCase(),
    baseUrl: `https://${id}.example/v1`,
    enabled: true,
    supportsEmbeddings: false,
    headers: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as OpenAICompatibleProviderRow;

const chatEntry = (displayName: string) => ({
  displayName,
  model: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chatCache.clear();
  mocks.embeddingCache.clear();
  mocks.listEnabledOpenAICompatibleProviders.mockResolvedValue([]);
  mocks.listOpenAICompatibleProviders.mockResolvedValue([]);
  mocks.discoverOpenAICompatibleModels.mockResolvedValue([]);
  mocks.getHiddenModels.mockReturnValue([]);
  mocks.loadOpenAIChatModels.mockResolvedValue({});
  mocks.loadOpenAIEmbeddingModels.mockResolvedValue({});
});

describe('provider registries and dynamic catalogs', () => {
  it('retains first-party OpenAI and removes retired backend registrations and metadata', () => {
    expect(chatModelProviders).toHaveProperty('openai');
    expect(embeddingModelProviders).toHaveProperty('openai');
    expect(chatModelProviders).not.toHaveProperty('lmstudio');
    expect(chatModelProviders).not.toHaveProperty('custom_openai');
    expect(embeddingModelProviders).not.toHaveProperty('lmstudio');
    expect(PROVIDER_METADATA).not.toHaveProperty('lmstudio');
    expect(PROVIDER_METADATA).not.toHaveProperty('custom_openai');
  });

  it('appends enabled compatible providers in display-name order and sorts discovered model ids', async () => {
    const beta = provider('provider-b', 'Beta Gateway');
    const alpha = provider('provider-a', 'Alpha Gateway');
    mocks.listEnabledOpenAICompatibleProviders.mockResolvedValue([beta, alpha]);
    mocks.loadOpenAIChatModels.mockResolvedValue({
      'gpt-static': chatEntry('Static'),
    });
    mocks.discoverOpenAICompatibleModels.mockImplementation(
      async (row: OpenAICompatibleProviderRow) =>
        row.id === 'provider-a'
          ? [{ id: 'z-model', name: ' Z model ' }, { id: 'a-model' }]
          : [{ id: 'beta-model', name: 'Beta model' }],
    );

    const models = await getAvailableChatModelProviders({
      includeHidden: true,
      forceRefresh: true,
    });

    expect(Object.keys(models)).toEqual([
      'openai',
      'openai-compatible:provider-a',
      'openai-compatible:provider-b',
    ]);
    expect(Object.keys(models['openai-compatible:provider-a'])).toEqual([
      'a-model',
      'z-model',
    ]);
    expect(models['openai-compatible:provider-a']['z-model'].displayName).toBe(
      'Z model',
    );
    expect(models['openai-compatible:provider-a']['a-model'].displayName).toBe(
      'a-model',
    );
    expect(
      models['openai-compatible:provider-b']['beta-model'].displayName,
    ).toBe('Beta model');
    expect(mocks.createOpenAICompatibleChatModel).toHaveBeenCalledWith(
      alpha,
      'z-model',
    );
  });

  it('isolates one failed dynamic provider while retaining the others', async () => {
    const bad = provider('provider-bad', 'Bad Gateway');
    const good = provider('provider-good', 'Good Gateway');
    mocks.listEnabledOpenAICompatibleProviders.mockResolvedValue([bad, good]);
    mocks.discoverOpenAICompatibleModels.mockImplementation(
      async (row: OpenAICompatibleProviderRow) => {
        if (row.id === bad.id) throw new Error('upstream secret');
        return [{ id: 'good-model' }];
      },
    );

    const models = await getAvailableChatModelProviders({
      includeHidden: true,
    });

    expect(models).not.toHaveProperty('openai-compatible:provider-bad');
    expect(models['openai-compatible:provider-good']).toHaveProperty(
      'good-model',
    );
  });

  it('loads embeddings only for compatible providers that opt in', async () => {
    const chatOnly = provider('chat-only', 'Chat Only');
    const embeddingProvider = provider('with-embeddings', 'With Embeddings', {
      supportsEmbeddings: true,
    });
    mocks.listEnabledOpenAICompatibleProviders.mockResolvedValue([
      embeddingProvider,
      chatOnly,
    ]);
    mocks.discoverOpenAICompatibleModels.mockResolvedValue([
      { id: 'shared-model' },
    ]);

    const models = await getAvailableEmbeddingModelProviders({
      includeHidden: true,
    });

    expect(Object.keys(models)).toEqual(['openai-compatible:with-embeddings']);
    expect(models['openai-compatible:with-embeddings']).toHaveProperty(
      'shared-model',
    );
    expect(mocks.createOpenAICompatibleEmbeddingModel).toHaveBeenCalledWith(
      embeddingProvider,
      'shared-model',
    );
    expect(mocks.createOpenAICompatibleEmbeddingModel).not.toHaveBeenCalledWith(
      chatOnly,
      'shared-model',
    );
  });

  it('applies exact scoped hides and legacy global hides without mutating catalog results', async () => {
    const dynamic = provider('provider-a', 'Dynamic');
    mocks.listEnabledOpenAICompatibleProviders.mockResolvedValue([dynamic]);
    mocks.loadOpenAIChatModels.mockResolvedValue({
      shared: chatEntry('Static shared'),
      visible: chatEntry('Visible'),
    });
    mocks.discoverOpenAICompatibleModels.mockResolvedValue([
      { id: 'shared' },
      { id: 'dynamic-only' },
    ]);
    mocks.getHiddenModels.mockReturnValue([
      { provider: 'openai-compatible:provider-a', model: 'shared' },
    ]);

    const scoped = await getAvailableChatModelProviders();
    expect(scoped.openai).toHaveProperty('shared');
    expect(scoped['openai-compatible:provider-a']).not.toHaveProperty('shared');
    expect(scoped['openai-compatible:provider-a']).toHaveProperty(
      'dynamic-only',
    );

    mocks.getHiddenModels.mockReturnValue(['shared']);
    const globallyHidden = await getAvailableChatModelProviders();
    expect(globallyHidden.openai).not.toHaveProperty('shared');
    expect(globallyHidden['openai-compatible:provider-a']).not.toHaveProperty(
      'shared',
    );
    expect(globallyHidden['openai-compatible:provider-a']).toHaveProperty(
      'dynamic-only',
    );
  });

  it('keeps static and dynamic catalogs available when the dynamic store cannot be read', async () => {
    mocks.loadOpenAIChatModels.mockResolvedValue({
      'gpt-static': chatEntry('Static'),
    });
    mocks.listEnabledOpenAICompatibleProviders.mockRejectedValue(
      new Error('database unavailable'),
    );

    const models = await getAvailableChatModelProviders({
      includeHidden: true,
    });

    expect(models).toEqual({
      openai: { 'gpt-static': chatEntry('Static') },
    });
  });
});

describe('dynamic provider metadata', () => {
  it('publishes configured disabled/offline providers without discovering models', async () => {
    const offline = provider('offline', 'Offline Gateway', { enabled: false });
    const online = provider('online', 'Online Gateway');
    mocks.listOpenAICompatibleProviders.mockResolvedValue([online, offline]);

    const metadata = await getAvailableProviderMetadata();

    expect(metadata).toMatchObject({
      'openai-compatible:offline': {
        key: 'openai-compatible:offline',
        displayName: 'Offline Gateway',
      },
      'openai-compatible:online': {
        key: 'openai-compatible:online',
        displayName: 'Online Gateway',
      },
      openai: { key: 'openai', displayName: 'OpenAI' },
    });
    expect(mocks.discoverOpenAICompatibleModels).not.toHaveBeenCalled();
  });
});
