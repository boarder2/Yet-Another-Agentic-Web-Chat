import { test, expect } from '../fixtures/api';

test.describe('GET /api/config', () => {
  test('returns 200 with an object body', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });
});

test.describe('GET /api/models', () => {
  test('returns providers structure', async ({ request }) => {
    const res = await request.get('/api/models');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('chatModelProviders');
    expect(body).toHaveProperty('embeddingModelProviders');
  });
});
