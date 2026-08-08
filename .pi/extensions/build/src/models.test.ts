import { describe, it, expect } from 'vitest';
import { parseModelSpec, unresolvableModels } from './models.ts';

describe('parseModelSpec', () => {
  it('splits provider, id and thinking level', () => {
    expect(parseModelSpec('openai-codex/gpt-5.6-sol:medium')).toEqual({
      raw: 'openai-codex/gpt-5.6-sol:medium',
      provider: 'openai-codex',
      id: 'gpt-5.6-sol',
      thinkingLevel: 'medium',
    });
  });

  it('leaves the thinking level unset when none is pinned', () => {
    expect(parseModelSpec('~anthropic/claude-sonnet-latest')).toMatchObject({
      provider: '~anthropic',
      id: 'claude-sonnet-latest',
      thinkingLevel: null,
    });
  });

  it('reads a bare id as any provider', () => {
    expect(parseModelSpec('claude-sonnet-latest')).toMatchObject({
      provider: null,
      id: 'claude-sonnet-latest',
      thinkingLevel: null,
    });
  });

  it('takes a colon before the slash as part of the provider, not a level', () => {
    expect(parseModelSpec('http://host/model')).toMatchObject({
      provider: 'http:',
      thinkingLevel: null,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseModelSpec('  a/b:high  ').raw).toBe('a/b:high');
  });
});

const registry = (available: Array<{ provider: string; id: string }>) =>
  ({
    find: (provider: string, id: string) =>
      available.find(
        (model) => model.provider === provider && model.id === id,
      ) ?? null,
    getAvailable: () => available,
  }) as never;

describe('unresolvableModels', () => {
  const models = {
    plan: 'a/one',
    coder: 'a/two',
    tester: 'two',
    reviewer: 'b/three',
  };

  it('reports nothing when every role resolves', () => {
    expect(
      unresolvableModels(
        registry([
          { provider: 'a', id: 'one' },
          { provider: 'a', id: 'two' },
          { provider: 'b', id: 'three' },
        ]),
        models,
      ),
    ).toEqual([]);
  });

  it('names the role alongside the spec that did not match', () => {
    expect(
      unresolvableModels(registry([{ provider: 'a', id: 'one' }]), models),
    ).toEqual(['coder: a/two', 'tester: two', 'reviewer: b/three']);
  });
});
