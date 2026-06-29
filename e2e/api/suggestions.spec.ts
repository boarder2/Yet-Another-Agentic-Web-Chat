import { test, expect } from '../fixtures/api';

test.describe('POST /api/suggestions', () => {
  test('returns empty suggestions with test model (no XML tags in output)', async ({
    request,
  }) => {
    const res = await request.post('/api/suggestions', {
      data: {
        chatHistory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi, how can I help?' },
        ],
        chatModel: { provider: 'test', model: 'test-direct' },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // The test-direct model output lacks <suggestions> XML tags, so the
    // ListLineOutputParser returns an empty array.
    expect(body.suggestions).toEqual([]);
  });

  test('returns empty suggestions for a short conversation', async ({
    request,
  }) => {
    const res = await request.post('/api/suggestions', {
      data: {
        chatHistory: [{ role: 'user', content: 'Tell me a fact.' }],
        chatModel: { provider: 'test', model: 'test-direct' },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
  });

  test('errors on invalid chat model provider', async ({ request }) => {
    const res = await request.post('/api/suggestions', {
      data: {
        chatHistory: [{ role: 'user', content: 'Hello' }],
        chatModel: { provider: 'nonexistent', model: 'nonexistent' },
      },
    });
    // The route's catch block returns 500 for unhandled errors (TypeError from
    // accessing an undefined provider). Ideally this should be 400, but the
    // handler wraps all errors generically.
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.message).toBeTruthy();
  });
});
