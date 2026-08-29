import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    getAimlApiKey: vi.fn(() => ''),
    getAnthropicApiKey: vi.fn(() => ''),
    getCustomOpenaiApiKey: vi.fn(() => ''),
    getCustomOpenaiApiUrl: vi.fn(() => ''),
    getCustomOpenaiModelName: vi.fn(() => ''),
    getDeepseekApiKey: vi.fn(() => ''),
    getGeminiApiKey: vi.fn(() => ''),
    getGroqApiKey: vi.fn(() => ''),
    getLMStudioApiEndpoint: vi.fn(() => ''),
    getOpenaiApiKey: vi.fn(() => ''),
    getOpenrouterApiKey: vi.fn(() => 'openrouter-key'),
  },
  settings: {
    getOpenrouterQuantizations: vi.fn(),
  },
}));

vi.mock('../config', () => mocks.config);
vi.mock('../settings/server', () => mocks.settings);

import {
  getCachedChatModels,
  invalidateModelCache,
  setCachedChatModels,
} from './modelCache';

const unrestricted = () => ({
  valid: true as const,
  raw: null,
  quantizations: [],
  canonical: '[]',
});

const selected = (raw: string, quantizations: string[]) => ({
  valid: true as const,
  raw,
  quantizations,
  canonical: JSON.stringify(quantizations),
});

describe('OpenRouter model cache signature', () => {
  beforeEach(() => {
    invalidateModelCache();
    mocks.settings.getOpenrouterQuantizations.mockReturnValue(unrestricted());
  });

  it('expires an OpenRouter entry when the selected quantizations change', () => {
    const models = { 'model-a': { displayName: 'Model A' } };
    setCachedChatModels('openrouter', models);
    expect(getCachedChatModels('openrouter')).toBe(models);

    mocks.settings.getOpenrouterQuantizations.mockReturnValue(
      selected('["fp8"]', ['fp8']),
    );

    expect(getCachedChatModels('openrouter')).toBeNull();
  });

  it('expires an OpenRouter entry when persisted validity or raw state changes', () => {
    const models = { 'model-a': { displayName: 'Model A' } };
    setCachedChatModels('openrouter', models);

    mocks.settings.getOpenrouterQuantizations.mockReturnValue({
      valid: false as const,
      raw: '["fp8","fp8"]',
      quantizations: null,
      error: 'duplicate',
    });
    expect(getCachedChatModels('openrouter')).toBeNull();

    setCachedChatModels('openrouter', models);
    mocks.settings.getOpenrouterQuantizations.mockReturnValue(
      selected(' ["fp8"] ', ['fp8']),
    );
    expect(getCachedChatModels('openrouter')).toBeNull();
  });

  it('does not expire another provider when OpenRouter settings change', () => {
    const models = { 'model-a': { displayName: 'Model A' } };
    setCachedChatModels('openai', models);

    mocks.settings.getOpenrouterQuantizations.mockReturnValue(
      selected('["fp8"]', ['fp8']),
    );

    expect(getCachedChatModels('openai')).toBe(models);
  });
});
