import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOpenaiApiKey: vi.fn(() => 'openai-key'),
  getAnthropicApiKey: vi.fn(() => 'anthropic-key'),
  getGeminiApiKey: vi.fn(() => 'gemini-key'),
  getDeepseekApiKey: vi.fn(() => 'deepseek-key'),
}));

vi.mock('../config', () => mocks);

import { loadAnthropicChatModels } from './anthropic';
import { loadDeepseekChatModels } from './deepseek';
import { loadGeminiChatModels } from './gemini';
import { loadOpenAIChatModels } from './openai';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('direct provider capability discovery', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    mocks.getOpenaiApiKey.mockReturnValue('openai-key');
    mocks.getAnthropicApiKey.mockReturnValue('anthropic-key');
    mocks.getGeminiApiKey.mockReturnValue('gemini-key');
    mocks.getDeepseekApiKey.mockReturnValue('deepseek-key');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('annotates only profiled OpenAI chat models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'gpt-5.4' },
          { id: 'gpt-4o' },
          { id: 'text-embedding-3-small' },
          { id: 'gpt-4o-audio-preview' },
        ],
      }),
    );

    const models = await loadOpenAIChatModels();

    expect(Object.keys(models)).toEqual(['gpt-4o', 'gpt-5.4']);
    expect(models['gpt-5.4'].supportedReasoningEfforts).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(models['gpt-4o']).not.toHaveProperty('supportedReasoningEfforts');
  });

  it('annotates Anthropic adaptive and legacy profiles but not unprofiled models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' },
          {
            id: 'claude-opus-4-5-20251101',
            display_name: 'Claude Opus 4.5',
          },
          { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
        ],
      }),
    );

    const models = await loadAnthropicChatModels();

    expect(models['claude-opus-4-6'].supportedReasoningEfforts).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'max',
    ]);
    expect(
      models['claude-opus-4-5-20251101'].supportedReasoningEfforts,
    ).toEqual(['off', 'low', 'medium', 'high']);
    expect(models['claude-haiku-4-5']).not.toHaveProperty(
      'supportedReasoningEfforts',
    );
  });

  it('strips Gemini model prefixes and excludes non-chat or unprofiled models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        models: [
          { name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash' },
          { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro' },
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
          },
          {
            name: 'models/gemini-3-flash-image-preview',
            displayName: 'Gemini 3 Flash Image',
          },
          {
            name: 'models/text-embedding-005',
            displayName: 'Text Embedding 005',
          },
        ],
      }),
    );

    const models = await loadGeminiChatModels();

    expect(Object.keys(models)).toEqual([
      'gemini-2.5-flash',
      'gemini-3-flash',
      'gemini-3-pro',
    ]);
    expect(models['gemini-3-flash'].supportedReasoningEfforts).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(models['gemini-3-pro'].supportedReasoningEfforts).toEqual([
      'low',
      'high',
    ]);
    expect(models['gemini-2.5-flash']).not.toHaveProperty(
      'supportedReasoningEfforts',
    );
  });

  it('annotates DeepSeek V4 profiles and leaves legacy models at Provider default', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'deepseek-v4-flash' },
          { id: 'deepseek-v4-pro' },
          { id: 'deepseek-chat' },
          { id: 'deepseek-reasoner' },
        ],
      }),
    );

    const models = await loadDeepseekChatModels();

    expect(models['deepseek-v4-flash'].supportedReasoningEfforts).toEqual([
      'off',
      'low',
      'high',
      'max',
    ]);
    expect(models['deepseek-v4-pro'].supportedReasoningEfforts).toEqual([
      'off',
      'low',
      'high',
      'max',
    ]);
    expect(models['deepseek-chat']).not.toHaveProperty(
      'supportedReasoningEfforts',
    );
    expect(models['deepseek-reasoner']).not.toHaveProperty(
      'supportedReasoningEfforts',
    );
  });
});
