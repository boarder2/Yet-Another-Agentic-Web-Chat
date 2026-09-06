import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
  getAvailableEmbeddingModelProviders: vi.fn(),
  getEmbeddingModelSelection: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ default: mocks.db }));
vi.mock('@/lib/db/schema', () => ({ memories: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('@/lib/utils/memoryEmbedding', () => ({
  embedMemoryContent: vi.fn(),
}));
vi.mock('@/lib/providers', () => ({
  getAvailableEmbeddingModelProviders:
    mocks.getAvailableEmbeddingModelProviders,
}));
vi.mock('@/lib/settings/server', () => ({
  getEmbeddingModelSelection: mocks.getEmbeddingModelSelection,
}));
vi.mock('@/lib/utils/cachedEmbeddings', () => ({
  CachedEmbeddings: class {
    constructor(
      readonly model: unknown,
      readonly provider: string,
      readonly name: string,
    ) {}
  },
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({
    openai: {
      fallback: { model: {} },
    },
  });
});

describe('memory reindex model selection', () => {
  it('returns a validation error for an explicit stale embedding model', async () => {
    mocks.getEmbeddingModelSelection.mockReturnValue({
      provider: 'openai',
      name: 'deleted-embedding-model',
    });

    const response = await POST();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid embedding model selected',
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('uses the first embedding model when the selection is truly absent', async () => {
    mocks.getEmbeddingModelSelection.mockReturnValue({
      provider: '',
      name: '',
    });
    mocks.db.select.mockReturnValue({
      from: () => ({
        all: async () => [],
      }),
    });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      count: 0,
    });
    expect(mocks.db.select).toHaveBeenCalledOnce();
  });
});
