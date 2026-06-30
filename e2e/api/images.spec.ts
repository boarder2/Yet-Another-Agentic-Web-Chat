import { test, expect } from '../fixtures/api';

test.describe('POST /api/images', () => {
  test('returns 400 for an invalid chat model provider', async ({
    request,
  }) => {
    const res = await request.post('/api/images', {
      data: {
        query: 'x',
        chatHistory: [],
        chatModel: { provider: 'nonexistent-provider', model: 'nope' },
      },
    });
    // An unresolvable chat model must hit the explicit if (!llm) guard and
    // return 400 { error: 'Invalid chat model' } — the intended contract.
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid chat model' });
  });
});
