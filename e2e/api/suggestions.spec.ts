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

  test('resolves default provider when chatModel is omitted', async ({
    request,
  }) => {
    const res = await request.post('/api/suggestions', {
      data: {
        chatHistory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.suggestions)).toBe(true);
  });

  test('handles longer conversation history', async ({ request }) => {
    const res = await request.post('/api/suggestions', {
      data: {
        chatHistory: [
          { role: 'user', content: 'What is the capital of France?' },
          { role: 'assistant', content: 'The capital of France is Paris.' },
          { role: 'user', content: 'Tell me more about it.' },
          { role: 'assistant', content: 'Paris is known for its culture.' },
          { role: 'user', content: 'What about the food?' },
        ],
        chatModel: { provider: 'test', model: 'test-direct' },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.suggestions)).toBe(true);
    // The test model always returns the same text without <suggestions> tags.
    expect(body.suggestions).toEqual([]);
  });

  test('rejects an invalid chat model provider with 400', async ({
    request,
  }) => {
    const res = await request.post('/api/suggestions', {
      data: {
        chatHistory: [{ role: 'user', content: 'Hello' }],
        chatModel: { provider: 'nonexistent', model: 'nonexistent' },
      },
    });
    // An unresolvable model must hit the explicit `if (!llm)` guard, not throw.
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid chat model' });
  });

  test('parses real suggestions from a model that emits <suggestions> XML', async ({
    request,
  }) => {
    const res = await request.post('/api/suggestions', {
      data: {
        chatHistory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi, how can I help?' },
        ],
        chatModel: { provider: 'test', model: 'test-structured' },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.suggestions).toEqual([
      'What else should I know about this topic?',
      'How does this compare to related approaches?',
      'What are the practical next steps?',
    ]);
  });
});
