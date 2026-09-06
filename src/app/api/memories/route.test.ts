import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const insertExecute = vi.fn(async () => undefined);
  const insertValues = vi.fn(() => ({ execute: insertExecute }));
  const findFirst = vi.fn();

  return {
    db: {
      insert: vi.fn(() => ({ values: insertValues })),
      query: { memories: { findFirst } },
    },
    insertValues,
    getAvailableChatModelProviders: vi.fn(),
    getAvailableEmbeddingModelProviders: vi.fn(),
    getEmbeddingModelSelection: vi.fn(),
    getMemoryModelSelection: vi.fn(),
    embedMemoryContent: vi.fn(),
    classifyMemory: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ default: mocks.db }));
vi.mock('@/lib/db/schema', () => ({ memories: {} }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  like: vi.fn(),
}));
vi.mock('@/lib/utils/memoryCategories', () => ({
  MEMORY_CATEGORIES: ['Preference'],
  classifyMemory: mocks.classifyMemory,
}));
vi.mock('@/lib/utils/memoryEmbedding', () => ({
  embedMemoryContent: mocks.embedMemoryContent,
}));
vi.mock('@/lib/providers', () => ({
  getAvailableChatModelProviders: mocks.getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders:
    mocks.getAvailableEmbeddingModelProviders,
}));
vi.mock('@/lib/settings/server', () => ({
  getEmbeddingModelSelection: mocks.getEmbeddingModelSelection,
  getMemoryModelSelection: mocks.getMemoryModelSelection,
}));
vi.mock('@/lib/utils/cachedEmbeddings', () => ({
  CachedEmbeddings: class {
    constructor(
      readonly model: unknown,
      readonly provider: string,
      readonly name: string,
    ) {}

    getIdentifier(): string {
      return `${this.provider}/${this.name}`;
    }
  },
}));

import { POST } from './route';

const post = () =>
  POST(
    new Request('http://localhost/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Remember this preference' }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmbeddingModelSelection.mockReturnValue({ provider: '', name: '' });
  mocks.getMemoryModelSelection.mockReturnValue({ provider: '', name: '' });
  mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({});
  mocks.getAvailableChatModelProviders.mockResolvedValue({});
  mocks.embedMemoryContent.mockResolvedValue([0.1, 0.2]);
  mocks.classifyMemory.mockResolvedValue('Preference');
  mocks.db.query.memories.findFirst.mockResolvedValue({ id: 'created-memory' });
});

describe('memory model selection', () => {
  it('uses the first available embedding and chat models only when both selections are absent', async () => {
    const embedding = { kind: 'embedding' };
    const chat = { kind: 'chat' };
    mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({
      'openai-compatible:provider-1': {
        'local-embed': { model: embedding },
      },
    });
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      'openai-compatible:provider-1': {
        'local-chat': { model: chat },
      },
    });

    const response = await post();

    expect(response.status).toBe(201);
    expect(mocks.embedMemoryContent).toHaveBeenCalledWith(
      'Remember this preference',
      expect.objectContaining({
        provider: 'openai-compatible:provider-1',
        name: 'local-embed',
      }),
    );
    expect(mocks.classifyMemory).toHaveBeenCalledWith(
      'Remember this preference',
      chat,
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingModel: 'openai-compatible:provider-1/local-embed',
      }),
    );
  });

  it('does not fall back from an explicit stale memory model', async () => {
    mocks.getAvailableChatModelProviders.mockResolvedValue({
      openai: {
        fallback: { model: { kind: 'fallback' } },
      },
    });
    mocks.getMemoryModelSelection.mockReturnValue({
      provider: 'openai',
      name: 'deleted-memory-model',
    });

    const response = await post();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to create memory',
    });
    expect(mocks.classifyMemory).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it('does not fall back from an explicit stale embedding model', async () => {
    mocks.getAvailableEmbeddingModelProviders.mockResolvedValue({
      openai: {
        fallback: { model: { kind: 'fallback' } },
      },
    });
    mocks.getEmbeddingModelSelection.mockReturnValue({
      provider: 'openai',
      name: 'deleted-embedding-model',
    });

    const response = await post();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to create memory',
    });
    expect(mocks.embedMemoryContent).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });
});
