import { describe, expect, it } from 'vitest';
import {
  getNativeReasoningEffortConfig,
  getSupportedReasoningEfforts,
  type ReasoningEffort,
} from './reasoningEffort';

const scenarios = [
  { provider: 'openrouter', model: 'openai/gpt-5.4' },
  { provider: 'openai', model: 'gpt-5.4' },
  { provider: 'anthropic', model: 'claude-opus-4-6' },
  { provider: 'gemini', model: 'gemini-3-flash' },
  { provider: 'groq', model: 'qwen/qwen3.8-27b' },
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
] as const;

function expectedRequest(
  provider: (typeof scenarios)[number]['provider'],
  effort: ReasoningEffort,
): Record<string, unknown> {
  switch (provider) {
    case 'openrouter':
      return { reasoning: { effort: effort === 'off' ? 'none' : effort } };
    case 'openai':
      return { reasoning: { effort: effort === 'off' ? 'none' : effort } };
    case 'anthropic':
      return effort === 'off'
        ? { thinking: { type: 'disabled' } }
        : {
            output_config: { effort },
            thinking: { type: 'adaptive' },
          };
    case 'gemini':
      return {
        generationConfig: {
          thinkingConfig: { thinkingLevel: effort.toUpperCase() },
        },
      };
    case 'groq':
      return { reasoning_effort: effort === 'off' ? 'none' : effort };
    case 'deepseek':
      return effort === 'off'
        ? { thinking: { type: 'disabled' } }
        : {
            reasoning_effort: effort,
            thinking: { type: 'enabled' },
          };
  }
}

describe('native reasoning effort levels', () => {
  it('maps every advertised level to the provider-native request shape', () => {
    for (const scenario of scenarios) {
      const supported = getSupportedReasoningEfforts(
        scenario.provider,
        scenario.model,
      );

      expect(supported, `${scenario.provider}/${scenario.model}`).toBeDefined();
      for (const effort of supported ?? []) {
        expect(
          getNativeReasoningEffortConfig(
            scenario.provider,
            scenario.model,
            effort,
          )?.request,
          `${scenario.provider}/${scenario.model}/${effort}`,
        ).toEqual(expectedRequest(scenario.provider, effort));
      }
    }
  });
});
