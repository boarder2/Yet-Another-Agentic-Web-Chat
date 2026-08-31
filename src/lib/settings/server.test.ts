import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  readError: null as Error | null,
}));

vi.mock('@/lib/db', () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({
          all: () => {
            if (state.readError) throw state.readError;
            return state.rows;
          },
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  appSettings: { key: 'key' },
}));

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn(),
}));

import { getCodeExecutionAutoRun, getOpenrouterQuantizations } from './server';

describe('getCodeExecutionAutoRun', () => {
  it.each([
    { label: 'absent', rows: [] },
    {
      label: 'malformed',
      rows: [{ key: 'codeExecutionAutoRun', value: 'TRUE' }],
    },
    {
      label: 'invalid',
      rows: [{ key: 'codeExecutionAutoRun', value: '1' }],
    },
  ])('fails closed when the setting is $label', ({ rows }) => {
    state.readError = null;
    state.rows = rows;
    expect(getCodeExecutionAutoRun()).toBe(false);
  });

  it('returns true only for the persisted true value', () => {
    state.readError = null;
    state.rows = [{ key: 'codeExecutionAutoRun', value: 'true' }];
    expect(getCodeExecutionAutoRun()).toBe(true);
  });

  it('fails closed when settings cannot be read', () => {
    state.readError = new Error('database unavailable');
    expect(getCodeExecutionAutoRun()).toBe(false);
    state.readError = null;
  });
});

describe('getOpenrouterQuantizations', () => {
  it('returns the valid unrestricted default when the row is absent', () => {
    state.readError = null;
    state.rows = [];

    expect(getOpenrouterQuantizations()).toEqual({
      valid: true,
      raw: null,
      quantizations: [],
      canonical: '[]',
    });
  });

  it('parses a persisted value through the shared contract', () => {
    state.rows = [{ key: 'openrouterQuantizations', value: '["fp8","int4"]' }];

    expect(getOpenrouterQuantizations()).toEqual({
      valid: true,
      raw: '["fp8","int4"]',
      quantizations: ['int4', 'fp8'],
      canonical: '["int4","fp8"]',
    });
  });

  it('preserves invalid persisted state for fail-closed callers', () => {
    state.rows = [{ key: 'openrouterQuantizations', value: '["fp8","fp8"]' }];

    const result = getOpenrouterQuantizations();
    expect(result.valid).toBe(false);
    expect(result.raw).toBe('["fp8","fp8"]');
    expect(result.quantizations).toBeNull();
  });
});
