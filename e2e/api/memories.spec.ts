import { test, expect } from '../fixtures/api';
import { seedMemory } from '../utils/seed';

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
  test('returns synchronous success with count', async ({ request }) => {
    const res = await request.post('/api/memories/reindex');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.count).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(0);
  });
});
