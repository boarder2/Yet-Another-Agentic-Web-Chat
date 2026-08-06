import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from './config.ts';

describe('mergeConfig', () => {
  it('returns defaults for empty or absent input', () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('takes valid overrides', () => {
    expect(
      mergeConfig({
        reviewerModel: '~openai/gpt-latest',
        checks: ['npm test', 'npm run lint'],
        maxRounds: 3,
        contextBudget: 0.4,
      }),
    ).toEqual({
      reviewerModel: '~openai/gpt-latest',
      checks: ['npm test', 'npm run lint'],
      maxRounds: 3,
      contextBudget: 0.4,
    });
  });

  it('falls back rather than accepting values that would break a run', () => {
    const config = mergeConfig({
      reviewerModel: '   ',
      checks: 'npm test',
      maxRounds: 0,
      contextBudget: 5,
    });
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('drops non-string entries from checks and ignores unknown keys', () => {
    const config = mergeConfig({ checks: ['npm test', 42, ''], nonsense: true });
    expect(config.checks).toEqual(['npm test']);
    expect(config).not.toHaveProperty('nonsense');
  });

  it('floors a fractional round count', () => {
    expect(mergeConfig({ maxRounds: 2.9 }).maxRounds).toBe(2);
  });
});
