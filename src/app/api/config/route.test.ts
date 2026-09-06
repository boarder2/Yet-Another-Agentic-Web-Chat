import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    getAnthropicApiKey: vi.fn(() => ''),
    getBaseUrl: vi.fn(() => ''),
    getBraveLLMApiKey: vi.fn(() => ''),
    getBraveSearchApiKey: vi.fn(() => ''),
    getCodeExecutionConfig: vi.fn(() => ({ enabled: false })),
    getDeepseekApiKey: vi.fn(() => ''),
    getGeminiApiKey: vi.fn(() => ''),
    getMojeekApiKey: vi.fn(() => ''),
    getOpenaiApiKey: vi.fn(() => ''),
    getOpenrouterApiKey: vi.fn(() => ''),
  },
  setCredential: vi.fn(),
  isEncryptionConfigured: vi.fn(() => true),
  getResolvedSearchCapabilities: vi.fn(() => ({})),
  invalidateModelCache: vi.fn(),
  getAvailableChatModelProviders: vi.fn(async () => ({})),
  getAvailableEmbeddingModelProviders: vi.fn(async () => ({})),
  getAvailableProviderMetadata: vi.fn(async () => ({
    openai: { key: 'openai', displayName: 'OpenAI' },
    'openai-compatible:provider-1': {
      key: 'openai-compatible:provider-1',
      displayName: 'Local Gateway',
    },
  })),
}));

vi.mock('@/lib/config', () => mocks.config);
vi.mock('@/lib/credentials', () => ({ setCredential: mocks.setCredential }));
vi.mock('@/lib/encryption', () => ({
  isEncryptionConfigured: mocks.isEncryptionConfigured,
}));
vi.mock('@/lib/search/providers', () => ({
  getResolvedSearchCapabilities: mocks.getResolvedSearchCapabilities,
}));
vi.mock('@/lib/providers/modelCache', () => ({
  invalidateModelCache: mocks.invalidateModelCache,
}));
vi.mock('@/lib/providers', () => ({
  getAvailableChatModelProviders: mocks.getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders:
    mocks.getAvailableEmbeddingModelProviders,
  getAvailableProviderMetadata: mocks.getAvailableProviderMetadata,
}));

import { GET, POST } from './route';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('/api/config retired provider contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('omits retired credentials from GET', async () => {
    const response = await GET(new Request('http://localhost/api/config'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty('groqApiKey');
    expect(body).not.toHaveProperty('aimlApiKey');
    expect(body.providerMetadata).toEqual({
      openai: { key: 'openai', displayName: 'OpenAI' },
      'openai-compatible:provider-1': {
        key: 'openai-compatible:provider-1',
        displayName: 'Local Gateway',
      },
    });
  });

  it('accepts retired credential fields as a successful no-op', async () => {
    const response = await post({
      groqApiKey: 'retired-groq-secret',
      aimlApiKey: 'retired-aiml-secret',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Config updated',
    });
    expect(mocks.setCredential).not.toHaveBeenCalled();
    expect(mocks.invalidateModelCache).not.toHaveBeenCalled();
  });
});
