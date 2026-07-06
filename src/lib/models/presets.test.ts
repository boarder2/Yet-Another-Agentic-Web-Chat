import { describe, it, expect } from 'vitest';
import { isModelRefAvailable } from './presets';

const modelsData = {
  openai: { 'gpt-4o': { displayName: 'GPT-4o' } },
  anthropic: { 'claude-sonnet-5': { displayName: 'Claude Sonnet 5' } },
};

describe('isModelRefAvailable', () => {
  it('returns true when the provider and model are both present', () => {
    expect(isModelRefAvailable('openai', 'gpt-4o', modelsData)).toBe(true);
  });

  it('returns false when the provider is present but the model is missing', () => {
    expect(isModelRefAvailable('openai', 'gpt-5', modelsData)).toBe(false);
  });

  it('returns false when the provider is missing', () => {
    expect(isModelRefAvailable('nonexistent', 'gpt-4o', modelsData)).toBe(
      false,
    );
  });

  it('returns true for custom_openai regardless of model', () => {
    expect(isModelRefAvailable('custom_openai', 'anything', modelsData)).toBe(
      true,
    );
  });

  it('returns true when modelsData is undefined', () => {
    expect(isModelRefAvailable('openai', 'gpt-4o', undefined)).toBe(true);
  });
});
