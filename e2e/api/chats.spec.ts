import { test, expect } from '../fixtures/api';

test.describe('GET /api/chats', () => {
  test('returns a chats array', async ({ request }) => {
    const res = await request.get('/api/chats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.chats)).toBe(true);
  });

  test('respects limit query param', async ({ request }) => {
    const res = await request.get('/api/chats?limit=1');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.chats.length).toBeLessThanOrEqual(1);
  });
});
