import { test, expect } from '../fixtures/api';
import { seedMemory, seedWorkspace } from '../utils/seed';

test.describe('GET /api/memories', () => {
  test('returns paginated list shape', async ({ request }) => {
    const res = await request.get('/api/memories');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('offset');
    expect(body).toHaveProperty('hasMore');
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBeGreaterThanOrEqual(0);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.hasMore).toBe(body.offset + body.limit < body.total);
    expect(body.data.length).toBeLessThanOrEqual(body.limit);
  });

  test('a seeded memory appears in the list', async ({ request }) => {
    const id = await seedMemory(request, { content: 'unique-mem-list-test' });
    const res = await request.get('/api/memories');
    const body = await res.json();
    const found = (body.data as Record<string, unknown>[]).find(
      (m) => m.id === id,
    );
    expect(found).toBeTruthy();
    expect((found as Record<string, unknown>).content).toBe(
      'unique-mem-list-test',
    );
    expect((found as Record<string, unknown>).sourceType).toBe('manual');
  });

  test('respects limit query param', async ({ request }) => {
    const res = await request.get('/api/memories?limit=2');
    const body = await res.json();
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  test('search by q param returns matching memories', async ({ request }) => {
    await seedMemory(request, { content: 'panda-search-term' });
    await seedMemory(request, { content: 'unrelated memory' });

    const res = await request.get(
      `/api/memories?q=${encodeURIComponent('panda')}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const m of body.data) {
      expect((m.content as string).toLowerCase()).toContain('panda');
    }
  });

  test('search with no matches returns empty data', async ({ request }) => {
    const res = await request.get(
      `/api/memories?q=${encodeURIComponent('xyznonexistent999')}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
  });

  test('filters by category', async ({ request }) => {
    // Seed a memory, then read its assigned category (LLM-classified).
    const id = await seedMemory(request, { content: 'category-filter-target' });
    const getRes = await request.get(`/api/memories/${id}`);
    const assigned = (await getRes.json()).category;

    // Filter by the assigned category — our memory must appear.
    const res = await request.get(
      `/api/memories?category=${encodeURIComponent(assigned)}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ids: string[] = (body.data as Record<string, unknown>[]).map(
      (m) => m.id as string,
    );
    expect(ids).toContain(id);
    // All returned memories must match the requested category.
    for (const m of body.data) {
      expect((m as Record<string, unknown>).category).toBe(assigned);
    }
  });

  test('filters by workspaceId', async ({ request }) => {
    const wsId = await seedWorkspace(request, { name: 'mem-ws-filter' });
    await seedMemory(request, {
      content: 'workspace-memory',
      workspaceId: wsId,
    });
    // Seed a non-workspace memory that should be excluded
    await seedMemory(request, { content: 'global-memory' });

    const res = await request.get(
      `/api/memories?workspaceId=${encodeURIComponent(wsId)}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const m of body.data) {
      expect(m.workspaceId).toBe(wsId);
    }
  });

  test('sorts by lastAccessedAt and accessCount', async ({ request }) => {
    await seedMemory(request, { content: 'sort-test-a' });
    await seedMemory(request, { content: 'sort-test-b' });

    for (const sort of ['lastAccessedAt', 'accessCount', 'createdAt']) {
      const res = await request.get(
        `/api/memories?sort=${encodeURIComponent(sort)}`,
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
    }
  });

  test('hasMore is true when results cross page boundary', async ({
    request,
  }) => {
    await seedMemory(request, { content: 'page-a' });
    await seedMemory(request, { content: 'page-b' });
    await seedMemory(request, { content: 'page-c' });

    const res = await request.get('/api/memories?limit=2&offset=0');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.limit).toBe(2);
    expect(body.hasMore).toBe(true);
  });
});

test.describe('POST /api/memories', () => {
  test('creates a memory and returns 201 with the object', async ({
    request,
  }) => {
    const res = await request.post('/api/memories', {
      data: { content: 'test-create-memory' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.content).toBe('test-create-memory');
    expect([
      'Preference',
      'Profile',
      'Professional',
      'Project',
      'Instruction',
    ]).toContain(body.category);
    expect(body.sourceType).toBe('manual');
  });

  test('rejects missing content with 400', async ({ request }) => {
    const res = await request.post('/api/memories', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content is required');
  });

  test('rejects empty content with 400', async ({ request }) => {
    const res = await request.post('/api/memories', {
      data: { content: '   ' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content is required');
  });

  test('associates a memory with a workspace when workspaceId is provided', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request, { name: 'mem-ws-create' });
    const res = await request.post('/api/memories', {
      data: { content: 'workspace-bound-memory', workspaceId: wsId },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.workspaceId).toBe(wsId);
    expect(body.content).toBe('workspace-bound-memory');
    expect(body.sourceType).toBe('manual');
  });
});

test.describe('GET /api/memories/[id]', () => {
  test('returns a memory by id', async ({ request }) => {
    const id = await seedMemory(request, { content: 'get-by-id-memory' });
    const res = await request.get(`/api/memories/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.content).toBe('get-by-id-memory');
    expect(body.sourceType).toBe('manual');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.get('/api/memories/nonexistent-id');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Memory not found');
  });
});

test.describe('PUT /api/memories/[id]', () => {
  test('updates a memory and returns it', async ({ request }) => {
    const id = await seedMemory(request, { content: 'before-update' });
    const res = await request.put(`/api/memories/${id}`, {
      data: { content: 'after-update' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.content).toBe('after-update');
    expect(body.sourceType).toBe('manual');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.put('/api/memories/nonexistent-id', {
      data: { content: 'updated' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Memory not found');
  });

  test('rejects missing content with 400', async ({ request }) => {
    const id = await seedMemory(request);
    const res = await request.put(`/api/memories/${id}`, { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content is required');
  });
});

test.describe('DELETE /api/memories/[id]', () => {
  test('deletes a memory and returns success', async ({ request }) => {
    const id = await seedMemory(request);
    const res = await request.delete(`/api/memories/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.delete('/api/memories/nonexistent-id');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Memory not found');
  });

  test('delete then GET returns 404', async ({ request }) => {
    const id = await seedMemory(request);
    await request.delete(`/api/memories/${id}`);
    const res = await request.get(`/api/memories/${id}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Memory not found');
  });
});

test.describe('POST /api/memories/reindex', () => {
  test('returns success with a count field', async ({ request }) => {
    // Seed memories so the reindex loop has data to process.
    await seedMemory(request, { content: 'reindex-memory-a' });
    await seedMemory(request, { content: 'reindex-memory-b' });

    const res = await request.post('/api/memories/reindex');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.count).toBe('number');
  });
});
