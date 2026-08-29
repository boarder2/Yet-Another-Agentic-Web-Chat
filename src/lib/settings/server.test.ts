import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
}));

vi.mock('@/lib/db', () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({ all: () => state.rows }),
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

import { getOpenrouterQuantizations } from './server';

describe('getOpenrouterQuantizations', () => {
  it('returns the valid unrestricted default when the row is absent', () => {
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
