import { test, expect } from '../fixtures/api';

test.describe('GET /api/autocomplete', () => {
  test('returns browser-suggestions format with empty suggestions', async ({
    request,
  }) => {
    const res = await request.get('/api/autocomplete?q=test');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0]).toBe('test');
    expect(Array.isArray(body[1])).toBe(true);
  });

  test('handles empty query', async ({ request }) => {
    const res = await request.get('/api/autocomplete?q=');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual(['', []]);
  });

  test('returns content-type application/x-suggestions+json', async ({
    request,
  }) => {
    const res = await request.get('/api/autocomplete?q=hello');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain(
      'application/x-suggestions+json',
    );
  });
});
