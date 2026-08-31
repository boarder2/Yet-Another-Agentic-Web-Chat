import { describe, expect, it } from 'vitest';
import { validatePanelConfig } from './panel';

describe('panel model-reference validation', () => {
  it('accepts executor effort while keeping the panel bounds', () => {
    expect(
      validatePanelConfig({
        executors: [
          { provider: 'openai', name: 'gpt-5.4', reasoningEffort: 'high' },
          {
            provider: 'anthropic',
            name: 'claude-opus-4-6',
            reasoningEffort: 'low',
            imageCapable: true,
          },
        ],
        options: {},
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    {
      name: 'an invalid effort',
      panel: {
        executors: [
          { provider: 'openai', name: 'gpt-5.4', reasoningEffort: 'default' },
          { provider: 'openai', name: 'gpt-5.4' },
        ],
      },
    },
    {
      name: 'an unknown executor field',
      panel: {
        executors: [
          { provider: 'openai', name: 'gpt-5.4', effort: 'high' },
          { provider: 'openai', name: 'gpt-5.4' },
        ],
      },
    },
  ])('rejects $name at the panel contract boundary', ({ panel }) => {
    const result = validatePanelConfig(panel);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid panel config/);
  });

  it('still rejects executor counts outside the contract', () => {
    expect(validatePanelConfig({ executors: [] })).toEqual({
      ok: false,
      error: 'Panel requires at least 2 executors.',
    });
    expect(
      validatePanelConfig({
        executors: [
          { provider: 'a', name: 'a' },
          { provider: 'b', name: 'b' },
          { provider: 'c', name: 'c' },
          { provider: 'd', name: 'd' },
          { provider: 'e', name: 'e' },
        ],
      }),
    ).toEqual({
      ok: false,
      error: 'Panel allows at most 4 executors.',
    });
  });
});
