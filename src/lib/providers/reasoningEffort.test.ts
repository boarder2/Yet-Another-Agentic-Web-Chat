import { describe, expect, it } from 'vitest';
import {
  REASONING_EFFORT_LABELS,
  REASONING_EFFORT_LEVELS,
  REASONING_EFFORT_ORDER,
  REASONING_EFFORT_OPTIONS,
  clampReasoningEffort,
  getNativeReasoningEffortConfig,
  getNativeReasoningEffortProfile,
  getReasoningEffortMetadata,
  getSupportedReasoningEfforts,
  isReasoningEffort,
  normalizeReasoningEfforts,
  parseReasoningEffort,
} from './reasoningEffort';

describe('reasoning effort contract', () => {
  it('publishes one stable ordered set of values and display labels', () => {
    expect(REASONING_EFFORT_ORDER).toBe(REASONING_EFFORT_LEVELS);
    expect(REASONING_EFFORT_LEVELS).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(REASONING_EFFORT_OPTIONS).toEqual(
      REASONING_EFFORT_LEVELS.map((value) => ({
        value,
        label: REASONING_EFFORT_LABELS[value],
      })),
    );
    expect(REASONING_EFFORT_LABELS).toEqual({
      off: 'Off',
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'X-high',
      max: 'Max',
    });
  });

  it('accepts only normalized levels and treats omission as Provider default', () => {
    for (const level of REASONING_EFFORT_LEVELS) {
      expect(isReasoningEffort(level)).toBe(true);
      expect(parseReasoningEffort(level)).toBe(level);
    }
    expect(isReasoningEffort(undefined)).toBe(false);
    expect(parseReasoningEffort(undefined)).toBeUndefined();

    for (const invalid of [null, '', 'default', 'MAX', 1, {}, []]) {
      expect(isReasoningEffort(invalid)).toBe(false);
      expect(() => parseReasoningEffort(invalid)).toThrow(
        /Invalid reasoning effort/,
      );
    }
  });

  it('normalizes advertised values and clamps stale requests to the nearest level', () => {
    expect(
      normalizeReasoningEfforts(['high', 'not-a-level', 'low', 'high', 'off']),
    ).toEqual(['off', 'low', 'high']);
    expect(clampReasoningEffort(undefined, ['low', 'high'])).toBeUndefined();
    expect(clampReasoningEffort('medium', undefined)).toBeUndefined();
    expect(clampReasoningEffort('medium', [])).toBeUndefined();
    expect(clampReasoningEffort('medium', ['low', 'high'])).toBe('low');
    expect(clampReasoningEffort('xhigh', ['low', 'high'])).toBe('high');
    expect(clampReasoningEffort('max', ['off', 'low', 'medium'])).toBe(
      'medium',
    );
    expect(clampReasoningEffort('high', ['medium', 'high'])).toBe('high');
  });

  it('profiles documented direct-provider model families and leaves unknown or budget-only models unannotated', () => {
    expect(getSupportedReasoningEfforts('openai', 'gpt-5.4')).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(
      getSupportedReasoningEfforts('anthropic', 'claude-opus-4-6'),
    ).toEqual(['off', 'low', 'medium', 'high', 'max']);
    expect(getSupportedReasoningEfforts('gemini', 'gemini-3-flash')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(getSupportedReasoningEfforts('groq', 'openai/gpt-oss-20b')).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(
      getSupportedReasoningEfforts('deepseek', 'deepseek-v4-flash'),
    ).toEqual(['off', 'low', 'high', 'max']);

    expect(getNativeReasoningEffortProfile('OPENAI', 'gpt-5.4')).toBeDefined();
    expect(getSupportedReasoningEfforts('openai', 'gpt-4o')).toBeUndefined();
    expect(
      getSupportedReasoningEfforts('openai', 'gpt-5.4-mini-audio'),
    ).toBeUndefined();
    expect(
      getSupportedReasoningEfforts('gemini', 'gemini-3-flash-image-preview'),
    ).toBeUndefined();
    expect(getReasoningEffortMetadata('aimlapi', 'gpt-5.4')).toEqual({});
  });

  it('uses OpenRouter discovery metadata and model exceptions without opting in budget controls', () => {
    expect(
      getSupportedReasoningEfforts('openrouter', 'vendor/unknown-model', {
        supportedParameters: ['reasoning'],
      }),
    ).toEqual(['low', 'medium', 'high']);
    expect(
      getSupportedReasoningEfforts('openrouter', 'openai/gpt-5.4:free', {
        supportedParameters: ['reasoning'],
      }),
    ).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
    expect(
      getSupportedReasoningEfforts('openrouter', 'vendor/explicit', {
        supportedParameters: ['reasoning'],
        reasoning: { supported_efforts: ['none', 'high'], mandatory: false },
      }),
    ).toEqual(['off', 'high']);
    expect(
      getSupportedReasoningEfforts('openrouter', 'vendor/mandatory', {
        reasoning: { supported_efforts: ['none', 'high'], mandatory: true },
      }),
    ).toEqual(['high']);
    expect(
      getSupportedReasoningEfforts('openrouter', 'vendor/all-levels', {
        reasoning: { supported_efforts: null },
      }),
    ).toEqual([...REASONING_EFFORT_LEVELS]);
    expect(
      getSupportedReasoningEfforts('openrouter', 'vendor/budget-only', {
        supportedParameters: ['reasoning_tokens', 'max_tokens'],
      }),
    ).toBeUndefined();
    expect(
      getSupportedReasoningEfforts('openrouter', 'vendor/unknown-model'),
    ).toBeUndefined();
  });
});

describe('native reasoning effort request fragments', () => {
  it.each([
    {
      provider: 'openrouter',
      model: 'openai/gpt-5.4',
      effort: 'high' as const,
      nativeEffort: 'high',
      request: { reasoning: { effort: 'high' } },
    },
    {
      provider: 'openrouter',
      model: 'openai/gpt-5.4',
      effort: 'off' as const,
      nativeEffort: 'none',
      request: { reasoning: { effort: 'none' } },
    },
    {
      provider: 'openai',
      model: 'gpt-5.4',
      effort: 'high' as const,
      nativeEffort: 'high',
      request: { reasoning: { effort: 'high' } },
    },
    {
      provider: 'openai',
      model: 'gpt-5.4',
      effort: 'off' as const,
      nativeEffort: 'none',
      request: { reasoning: { effort: 'none' } },
    },
    {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      effort: 'medium' as const,
      nativeEffort: 'medium',
      request: {
        output_config: { effort: 'medium' },
        thinking: { type: 'adaptive' },
      },
    },
    {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      effort: 'off' as const,
      request: { thinking: { type: 'disabled' } },
    },
    {
      provider: 'gemini',
      model: 'gemini-3-flash',
      effort: 'high' as const,
      nativeEffort: 'HIGH',
      request: {
        generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } },
      },
    },
    {
      provider: 'gemini',
      model: 'gemini-3-flash',
      effort: 'off' as const,
      request: {},
    },
    {
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      effort: 'high' as const,
      nativeEffort: 'high',
      request: { reasoning_effort: 'high' },
    },
    {
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      effort: 'off' as const,
      nativeEffort: 'none',
      request: { reasoning_effort: 'none' },
    },
    {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      effort: 'max' as const,
      nativeEffort: 'max',
      request: {
        reasoning_effort: 'max',
        thinking: { type: 'enabled' },
      },
    },
    {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      effort: 'off' as const,
      request: { thinking: { type: 'disabled' } },
    },
  ])(
    'maps $provider $effort to its native request shape',
    ({ provider, model, effort, nativeEffort, request }) => {
      expect(getNativeReasoningEffortConfig(provider, model, effort)).toEqual({
        provider,
        effort,
        ...(nativeEffort === undefined ? {} : { nativeEffort }),
        request,
      });
    },
  );

  it('does not map unsupported providers', () => {
    expect(
      getNativeReasoningEffortConfig('custom_openai', 'model', 'high'),
    ).toBeUndefined();
  });
});
