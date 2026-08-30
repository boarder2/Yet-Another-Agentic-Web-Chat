import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { ChatOpenRouter } from '@langchain/openrouter';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAvailableChatModelProviders: vi.fn(),
  getAvailableEmbeddingModelProviders: vi.fn(),
  getCustomOpenaiApiKey: vi.fn(() => ''),
  getCustomOpenaiApiUrl: vi.fn(() => ''),
  getCustomOpenaiModelName: vi.fn(() => ''),
  getEmbeddingModelSelection: vi.fn(() => ({ provider: '', name: '' })),
}));

vi.mock('@/lib/providers', () => ({
  getAvailableChatModelProviders: mocks.getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders:
    mocks.getAvailableEmbeddingModelProviders,
}));
vi.mock('@/lib/config', () => ({
  getCustomOpenaiApiKey: mocks.getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl: mocks.getCustomOpenaiApiUrl,
  getCustomOpenaiModelName: mocks.getCustomOpenaiModelName,
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

import { applyReasoningEffort } from './resolveModels';

type InvocationModel = BaseChatModel & {
  invocationParams(options: Record<string, unknown>): Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const invocationParams = (model: BaseChatModel) =>
  (model as InvocationModel).invocationParams({});

const freshModels = () => [
  {
    provider: 'openrouter',
    name: 'openai/gpt-5.4',
    model: new ChatOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-5.4',
    }) as unknown as BaseChatModel,
  },
  {
    provider: 'openai',
    name: 'gpt-5.4',
    model: new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-5.4',
    }) as unknown as BaseChatModel,
  },
  {
    provider: 'anthropic',
    name: 'claude-opus-4-6',
    model: new ChatAnthropic({
      apiKey: 'anthropic-key',
      model: 'claude-opus-4-6',
    }) as unknown as BaseChatModel,
  },
  {
    provider: 'gemini',
    name: 'gemini-3-flash',
    model: new ChatGoogleGenerativeAI({
      apiKey: 'gemini-key',
      model: 'gemini-3-flash',
    }) as unknown as BaseChatModel,
  },
  {
    provider: 'groq',
    name: 'qwen/qwen3.8-27b',
    model: new ChatGroq({
      apiKey: 'groq-key',
      model: 'qwen/qwen3.8-27b',
    }) as unknown as BaseChatModel,
  },
  {
    provider: 'deepseek',
    name: 'deepseek-v4-flash',
    model: new ChatOpenAI({
      apiKey: 'deepseek-key',
      model: 'deepseek-v4-flash',
      configuration: { baseURL: 'https://api.deepseek.com' },
    }) as unknown as BaseChatModel,
  },
];

describe('request-local reasoning effort binding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps high effort through every supported LangChain adapter', () => {
    for (const { provider, name, model } of freshModels()) {
      const configured = applyReasoningEffort(model, provider, name, 'high');
      const params = invocationParams(configured);

      expect(configured).not.toBe(model);
      switch (provider) {
        case 'openrouter':
          expect(params.reasoning).toEqual({ effort: 'high' });
          break;
        case 'openai':
          expect(params.reasoning_effort).toBe('high');
          break;
        case 'anthropic':
          expect(params.output_config).toEqual({ effort: 'high' });
          expect(params.thinking).toEqual({ type: 'adaptive' });
          break;
        case 'gemini':
          expect(asRecord(params.generationConfig).thinkingConfig).toEqual({
            thinkingLevel: 'HIGH',
          });
          break;
        case 'groq':
          expect(params.reasoning_effort).toBe('high');
          break;
        case 'deepseek':
          expect(params.reasoning_effort).toBe('high');
          expect(params.thinking).toEqual({ type: 'enabled' });
          break;
      }
    }
  });

  it('maps Off to each provider-native disabled or none form', () => {
    for (const { provider, name, model } of freshModels()) {
      const params = invocationParams(
        applyReasoningEffort(model, provider, name, 'off'),
      );

      switch (provider) {
        case 'openrouter':
          expect(params.reasoning).toEqual({ effort: 'none' });
          break;
        case 'openai':
          expect(params.reasoning_effort).toBe('none');
          break;
        case 'anthropic':
          expect(params.thinking).toEqual({ type: 'disabled' });
          expect(params.output_config).toBeUndefined();
          break;
        case 'gemini':
          // Gemini's profiled models have no native Off level; a stale Off
          // selection clamps to the nearest advertised level.
          expect(asRecord(params.generationConfig).thinkingConfig).toEqual({
            thinkingLevel: 'MINIMAL',
          });
          break;
        case 'groq':
          expect(params.reasoning_effort).toBe('none');
          break;
        case 'deepseek':
          expect(params.thinking).toEqual({ type: 'disabled' });
          expect(params.reasoning_effort).toBeUndefined();
          break;
      }
    }
  });

  it('omits all effort controls for Provider default and unsupported models', () => {
    for (const { provider, name, model } of freshModels()) {
      expect(applyReasoningEffort(model, provider, name, undefined)).toBe(
        model,
      );
      const params = invocationParams(model);
      expect(params.reasoning).toBeUndefined();
      expect(params.reasoning_effort).toBeUndefined();
      expect(params.output_config).toBeUndefined();
      expect(params.thinking).toBeUndefined();
      expect(asRecord(params.generationConfig).thinkingConfig).toBeUndefined();
    }

    const unsupported = new ChatOpenAI({
      apiKey: 'openai-key',
      model: 'gpt-4o',
    }) as unknown as BaseChatModel;
    expect(applyReasoningEffort(unsupported, 'openai', 'gpt-4o', 'high')).toBe(
      unsupported,
    );
  });

  it('does not mutate cached models or their OpenAI transport children', () => {
    const base = new ChatOpenAI({
      apiKey: 'deepseek-key',
      model: 'deepseek-v4-flash',
      modelKwargs: { existing: 'value' },
    });
    type OpenAIInternals = {
      modelKwargs: Record<string, unknown>;
      completions: { modelKwargs: Record<string, unknown> };
    };
    const baseInternals = base as unknown as OpenAIInternals;
    const originalCompletions = baseInternals.completions.modelKwargs;

    const configured = applyReasoningEffort(
      base as unknown as BaseChatModel,
      'deepseek',
      'deepseek-v4-flash',
      'high',
    ) as unknown as OpenAIInternals;

    expect(configured).not.toBe(base);
    expect(baseInternals.modelKwargs).toEqual({ existing: 'value' });
    expect(baseInternals.completions.modelKwargs).toBe(originalCompletions);
    expect(configured.modelKwargs).toEqual({
      existing: 'value',
      reasoning_effort: 'high',
      thinking: { type: 'enabled' },
    });
    expect(configured.completions.modelKwargs).toEqual(configured.modelKwargs);
  });

  it('surfaces an OpenRouter rejection without retrying without effort', async () => {
    const model = applyReasoningEffort(
      new ChatOpenRouter({
        apiKey: 'openrouter-key',
        model: 'openai/gpt-5.4',
      }) as unknown as BaseChatModel,
      'openrouter',
      'openai/gpt-5.4',
      'high',
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'reasoning effort is not supported', code: 400 },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(model.invoke('hello')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('reasoning effort is not supported'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
