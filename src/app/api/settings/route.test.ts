import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transactionTarget = {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ run: vi.fn() })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({ run: vi.fn() })),
      })),
    })),
  };

  return {
    transactionTarget,
    transaction: vi.fn((callback: (tx: typeof transactionTarget) => void) =>
      callback(transactionTarget),
    ),
    invalidateModelCache: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  default: { transaction: mocks.transaction },
}));

vi.mock('@/lib/db/schema', () => ({
  appSettings: { key: 'app_settings.key' },
}));

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn(),
}));

vi.mock('@/lib/settings/server', () => ({
  getAllSettings: vi.fn(),
}));

vi.mock('@/lib/providers/modelCache', () => ({
  invalidateModelCache: mocks.invalidateModelCache,
}));

import { PATCH } from './route';

const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('PATCH /api/settings OpenRouter cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates only the OpenRouter cache after accepted changes', async () => {
    expect((await patch({ openrouterQuantizations: '["fp8"]' })).status).toBe(
      204,
    );
    expect((await patch({ openrouterQuantizations: null })).status).toBe(204);
    expect((await patch({ ttsSpeed: '0.75' })).status).toBe(204);

    expect(mocks.invalidateModelCache).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateModelCache).toHaveBeenNthCalledWith(1, 'openrouter');
    expect(mocks.invalidateModelCache).toHaveBeenNthCalledWith(2, 'openrouter');
  });

  it('does not persist or invalidate when the quantization value is invalid', async () => {
    const response = await patch({
      openrouterQuantizations: '["fp8","fp8"]',
      ttsSpeed: 'must-not-be-written',
    });

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.invalidateModelCache).not.toHaveBeenCalled();
  });

  it('accepts independent effort keys and deletes them for Provider default', async () => {
    expect(
      (
        await patch({
          chatReasoningEffort: 'high',
          systemReasoningEffort: 'off',
        })
      ).status,
    ).toBe(204);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transactionTarget.insert).toHaveBeenCalledTimes(2);

    mocks.transaction.mockClear();
    mocks.transactionTarget.delete.mockClear();
    expect((await patch({ chatReasoningEffort: null })).status).toBe(204);
    expect(mocks.transactionTarget.delete).toHaveBeenCalledTimes(1);
  });

  it.each(['default', 'MAX', '', 'unsupported'])(
    'rejects malformed effort setting %s before writing it',
    async (value) => {
      const response = await patch({ chatReasoningEffort: value });

      expect(response.status).toBe(400);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
});
