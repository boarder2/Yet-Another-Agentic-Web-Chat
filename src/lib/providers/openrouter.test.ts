import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOpenRouter } from '@langchain/openrouter';

const mocks = vi.hoisted(() => ({
  getOpenrouterApiKey: vi.fn(() => 'test-openrouter-key'),
  getOpenrouterQuantizations: vi.fn(),
}));

vi.mock('../config', () => ({
  getOpenrouterApiKey: mocks.getOpenrouterApiKey,
}));
vi.mock('../settings/server', () => ({
  getOpenrouterQuantizations: mocks.getOpenrouterQuantizations,
}));

import { loadOpenrouterChatModels } from './openrouter';

const discoveredModels = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
  { id: 'meta-llama/llama-3.1-8b', name: 'Llama 3.1 8B' },
];

const unrestrictedConfig = () => ({
  valid: true as const,
  raw: null,
  quantizations: [],
  canonical: '[]',
});

const selectedConfig = (quantizations: string[]) => ({
  valid: true as const,
  raw: JSON.stringify(quantizations),
  quantizations,
  canonical: JSON.stringify(quantizations),
});

describe('OpenRouter provider adapter', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mocks.getOpenrouterApiKey.mockReturnValue('test-openrouter-key');
    mocks.getOpenrouterQuantizations.mockReturnValue(unrestrictedConfig());
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: discoveredModels }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('wraps every discovered model in ChatOpenRouter with default routing', async () => {
    const models = await loadOpenrouterChatModels();

    expect(Object.keys(models)).toEqual([
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.1-8b',
    ]);
    expect(models['openai/gpt-4o-mini'].displayName).toBe('GPT-4o mini');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    for (const { model } of Object.values(models)) {
      expect(model).toBeInstanceOf(ChatOpenRouter);
      const openRouterModel = model as ChatOpenRouter;
      expect(openRouterModel.apiKey).toBe('test-openrouter-key');
      expect(
        (openRouterModel.caller as unknown as { maxRetries: number })
          .maxRetries,
      ).toBe(10);
      expect(openRouterModel.provider).toBeUndefined();
    }
  });

  it('passes the exact non-empty quantization allow-list to every adapter', async () => {
    const quantizations = ['int4', 'fp8'];
    mocks.getOpenrouterQuantizations.mockReturnValue(
      selectedConfig(quantizations),
    );

    const models = await loadOpenrouterChatModels();

    for (const { model } of Object.values(models)) {
      const openRouterModel = model as ChatOpenRouter;
      expect(openRouterModel.provider).toEqual({ quantizations });
    }
  });

  it('retains supported parameters and derives native effort capabilities from discovery', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'vendor/unknown-reasoning',
              name: 'Unknown Reasoning',
              supported_parameters: ['reasoning', 'max_tokens'],
            },
            {
              id: 'vendor/budget-only',
              name: 'Budget Only',
              supported_parameters: ['reasoning_tokens', 'max_tokens'],
            },
            {
              id: 'vendor/explicit',
              name: 'Explicit Efforts',
              supported_parameters: ['reasoning'],
              reasoning: {
                supported_efforts: ['none', 'high'],
                mandatory: false,
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const models = await loadOpenrouterChatModels();

    expect(models['vendor/unknown-reasoning'].supportedParameters).toEqual([
      'reasoning',
      'max_tokens',
    ]);
    expect(
      models['vendor/unknown-reasoning'].supportedReasoningEfforts,
    ).toEqual(['low', 'medium', 'high']);
    expect(models['vendor/budget-only']).not.toHaveProperty(
      'supportedReasoningEfforts',
    );
    expect(models['vendor/explicit'].supportedReasoningEfforts).toEqual([
      'off',
      'high',
    ]);
  });

  it('fails closed on invalid persisted configuration before discovering models', async () => {
    mocks.getOpenrouterQuantizations.mockReturnValue({
      valid: false as const,
      raw: '["unknown"]',
      quantizations: null,
      error: 'Contains an unsupported OpenRouter quantization.',
    });

    await expect(loadOpenrouterChatModels()).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
