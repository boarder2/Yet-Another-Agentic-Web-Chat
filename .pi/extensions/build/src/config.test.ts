import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.ts';

const models = {
  plan: '~anthropic/claude-opus-latest',
  coder: '~anthropic/claude-sonnet-latest',
  tester: '~anthropic/claude-sonnet-latest',
  reviewer: '~openai/gpt-latest',
};

const problems = (raw: unknown): string[] => {
  const loaded = parseConfig(raw);
  return loaded.ok ? [] : loaded.problems;
};

describe('parseConfig', () => {
  it('reads a model per role and defaults the rest', () => {
    const loaded = parseConfig({ models });
    expect(loaded).toMatchObject({
      ok: true,
      config: { models, checks: [], maxRounds: 2, contextBudget: 0.6 },
    });
  });

  it('takes valid overrides', () => {
    const loaded = parseConfig({
      models,
      checks: ['npm test', 'npm run lint'],
      maxRounds: 3,
      contextBudget: 0.4,
      turnTimeoutMs: 60_000,
      blockedTimeoutMs: 30_000,
    });
    expect(loaded).toMatchObject({
      ok: true,
      config: {
        checks: ['npm test', 'npm run lint'],
        maxRounds: 3,
        contextBudget: 0.4,
        turnTimeoutMs: 60_000,
        blockedTimeoutMs: 30_000,
      },
    });
  });

  it('names every missing role rather than failing on the first', () => {
    expect(problems({ models: { plan: 'x' } })).toEqual([
      'models.coder is missing.',
      'models.tester is missing.',
      'models.reviewer is missing.',
    ]);
  });

  it('rejects a config with no models at all', () => {
    expect(problems({})).toHaveLength(4);
    expect(problems(undefined)).toHaveLength(4);
  });

  it('treats a blank or non-string model as missing', () => {
    expect(problems({ models: { ...models, coder: '   ' } })).toEqual([
      'models.coder is missing.',
    ]);
    expect(problems({ models: { ...models, coder: 42 } })).toEqual([
      'models.coder is missing.',
    ]);
  });

  it('points the old reviewerModel key at its replacement', () => {
    expect(problems({ models, reviewerModel: '~openai/gpt-latest' })).toEqual([
      '`reviewerModel` has been replaced by the `models` map. Move it to `models.reviewer`.',
    ]);
  });

  it('rejects an unknown role, which would otherwise look configured', () => {
    expect(problems({ models: { ...models, reviwer: 'x' } })).toEqual([
      'Unknown role(s) in models: reviwer.',
    ]);
  });

  it('falls back on non-model settings rather than blocking the run', () => {
    const loaded = parseConfig({
      models,
      checks: 'npm test',
      maxRounds: 0,
      contextBudget: 5,
      turnTimeoutMs: -1,
    });
    expect(loaded).toMatchObject({
      ok: true,
      config: { checks: [], maxRounds: 2, contextBudget: 0.6 },
    });
  });

  it('drops non-string entries from checks and ignores unknown keys', () => {
    const loaded = parseConfig({
      models,
      checks: ['npm test', 42, ''],
      nonsense: true,
    });
    expect(loaded.ok && loaded.config.checks).toEqual(['npm test']);
    expect(loaded.ok && loaded.config).not.toHaveProperty('nonsense');
  });

  it('floors a fractional round count', () => {
    const loaded = parseConfig({ models, maxRounds: 2.9 });
    expect(loaded.ok && loaded.config.maxRounds).toBe(2);
  });
});
