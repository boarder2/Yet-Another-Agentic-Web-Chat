import { test, expect } from '../fixtures/api';
import { seedChat } from '../utils/seed';

test.describe('GET /api/chats', () => {
  test('returns a chats array', async ({ request }) => {
    const res = await request.get('/api/chats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.chats)).toBe(true);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(typeof body.total).toBe('number');
    expect(typeof body.totalMessages).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
    for (const chat of body.chats) {
      expect(typeof chat.id).toBe('string');
      expect(typeof chat.messageCount).toBe('number');
    }
  });

  test('respects limit query param', async ({ request }) => {
    const res = await request.get('/api/chats?limit=1');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.chats.length).toBeLessThanOrEqual(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
  });

  test('includes a seeded chat in the list', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'unique-seed-test' });
    const res = await request.get('/api/chats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ids: string[] = body.chats.map((c: { id: string }) => c.id);
    expect(ids).toContain(chatId);
    const chat = body.chats.find((c: { id: string }) => c.id === chatId);
    expect(chat.focusMode).toBe('webSearch');
    expect(chat.messageCount).toBe(1);
  });

  test('respects offset query param', async ({ request }) => {
    const res1 = await request.get('/api/chats?limit=1&offset=0');
    const res2 = await request.get('/api/chats?limit=1&offset=1');
    expect(res1.ok()).toBe(true);
    expect(res2.ok()).toBe(true);
    const b1 = await res1.json();
    const b2 = await res2.json();
    expect(b1.limit).toBe(1);
    expect(b1.offset).toBe(0);
    expect(b2.limit).toBe(1);
    expect(b2.offset).toBe(1);
    // Different pages should not overlap in ids (when there are ≥2 chats)
    if (b1.chats.length === 1 && b2.chats.length === 1) {
      expect(b1.chats[0].id).not.toBe(b2.chats[0].id);
    }
  });

  test('response shape includes pagination fields', async ({ request }) => {
    const res = await request.get('/api/chats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(typeof body.total).toBe('number');
    expect(typeof body.totalMessages).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
  });

  test('chat objects include messageCount', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'message-count-test' });
    const res = await request.get('/api/chats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const chat = body.chats.find((c: { id: string }) => c.id === chatId);
    expect(chat).toBeTruthy();
    expect(chat.messageCount).toBe(1);
    expect(chat.focusMode).toBe('webSearch');
  });

  test('filters by pinned=1', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'pin-filter-test' });
    // Pin it
    await request.patch(`/api/chats/${chatId}`, { data: { pinned: true } });

    const res = await request.get('/api/chats?pinned=1');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ids = body.chats.map((c: { id: string }) => c.id);
    expect(ids).toContain(chatId);
    const chat = body.chats.find((c: { id: string }) => c.id === chatId);
    expect(chat.pinned).toBe(1);

    // Unpinned query should not include it
    const res2 = await request.get('/api/chats?pinned=0');
    // pinned=0 is not a supported filter — only '1' is checked. So this returns all.
    // Just verify it doesn't crash.
    expect(res2.ok()).toBe(true);
  });

  test('keyword search with q param returns matching results', async ({
    request,
  }) => {
    const chatId = await seedChat(request, {
      content: 'marzipan-kwsearch-test',
    });
    const res = await request.get(
      `/api/chats?q=${encodeURIComponent('marzipan-kwsearch-test')}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.chats)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(typeof body.totalMessages).toBe('number');
    // No limit/offset passed → search path omits them
    expect(body).not.toHaveProperty('limit');
    expect(body).not.toHaveProperty('offset');
    expect(body.hasMore).toBe(false);
    const ids: string[] = body.chats.map((c: { id: string }) => c.id);
    expect(ids).toContain(chatId);
    const chat = body.chats.find((c: { id: string }) => c.id === chatId);
    expect(chat.focusMode).toBe('webSearch');
    expect(chat.messageCount).toBe(1);
    expect(typeof chat.matchExcerpt).toBe('string');
    expect(chat.matchExcerpt.length).toBeGreaterThan(0);
  });

  test('keyword search with no results returns empty array', async ({
    request,
  }) => {
    const res = await request.get(
      `/api/chats?q=${encodeURIComponent('xyznonexistent987654321')}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.chats).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.totalMessages).toBe(0);
  });
});

test.describe('GET /api/chats/[id]', () => {
  test('returns chat and messages for a valid id', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'get-by-id-test' });
    const res = await request.get(`/api/chats/${chatId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.chat.id).toBe(chatId);
    expect(body.chat.focusMode).toBe('webSearch');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    const userMsg = body.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg).toBeTruthy();
    expect(userMsg.content).toBe('get-by-id-test');
    expect(userMsg.chatId).toBe(chatId);
    expect(typeof userMsg.messageId).toBe('string');
    expect(typeof userMsg.id).toBe('number');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.get(
      '/api/chats/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: 'Chat not found' });
  });
});

test.describe('PATCH /api/chats/[id]', () => {
  test('pins a chat', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'pin-test' });
    const res = await request.patch(`/api/chats/${chatId}`, {
      data: { pinned: true },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Verify it's pinned
    const getRes = await request.get(`/api/chats/${chatId}`);
    const chat = (await getRes.json()).chat;
    expect(chat.pinned).toBe(1);
  });

  test('unpins a chat', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'unpin-test' });
    await request.patch(`/api/chats/${chatId}`, { data: { pinned: true } });
    const res = await request.patch(`/api/chats/${chatId}`, {
      data: { pinned: false },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const getRes = await request.get(`/api/chats/${chatId}`);
    const chat = (await getRes.json()).chat;
    expect(chat.pinned).toBe(0);
  });

  test('rejects non-boolean pinned with 400', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'bad-pin-test' });
    const res = await request.patch(`/api/chats/${chatId}`, {
      data: { pinned: 'yes' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'pinned must be boolean' });
  });

  test('rejects missing pinned field with 400', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'no-pin-test' });
    const res = await request.patch(`/api/chats/${chatId}`, { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'pinned must be boolean' });
  });
});

test.describe('DELETE /api/chats/[id]', () => {
  test('deletes a chat', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'delete-test' });
    const res = await request.delete(`/api/chats/${chatId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: 'Chat deleted successfully' });

    // Subsequent GET returns 404
    const getRes = await request.get(`/api/chats/${chatId}`);
    expect(getRes.status()).toBe(404);
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.delete(
      '/api/chats/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: 'Chat not found' });
  });
});

test.describe('POST /api/chats/[id]/seen', () => {
  test('marks chat as seen and returns counts', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'seen-test' });
    const res = await request.post(`/api/chats/${chatId}/seen`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.historyCount).toBe('number');
    expect(body.historyCount).toBeGreaterThanOrEqual(0);
    expect(typeof body.scheduledCount).toBe('number');
    expect(body.scheduledCount).toBeGreaterThanOrEqual(0);
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.post(
      '/api/chats/00000000-0000-0000-0000-000000000000/seen',
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Chat not found' });
  });
});

test.describe('POST /api/chats/search', () => {
  test('returns 400 when query is missing', async ({ request }) => {
    const res = await request.post('/api/chats/search', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'Query is required' });
  });

  test('returns 400 when query is empty', async ({ request }) => {
    const res = await request.post('/api/chats/search', {
      data: { query: '' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'Query is required' });
  });

  test('returns matching chat for a valid query', async ({ request }) => {
    const chatId = await seedChat(request, { content: 'search-shape-test' });
    const res = await request.post('/api/chats/search', {
      data: {
        query: 'search shape test',
        chatModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.chats)).toBe(true);
    expect(Array.isArray(body.terms)).toBe(true);
    expect(body.terms.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(typeof body.totalMessages).toBe('number');
    const ids: string[] = body.chats.map((c: { id: string }) => c.id);
    expect(ids).toContain(chatId);
    const chat = body.chats.find((c: { id: string }) => c.id === chatId);
    expect(chat.focusMode).toBe('webSearch');
    expect(chat.messageCount).toBe(1);
    expect(typeof chat.matchExcerpt).toBe('string');
  });
});
