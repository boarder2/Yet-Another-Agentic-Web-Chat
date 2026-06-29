import { test, expect } from '../fixtures/api';
import { uid } from '../utils/helpers';

test.describe('POST /api/respond-now', () => {
  test('returns 400 when messageId is missing', async ({ request }) => {
    const res = await request.post('/api/respond-now', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing messageId');
  });

  test('succeeds for any messageId (soft-stop is best-effort)', async ({
    request,
  }) => {
    const res = await request.post('/api/respond-now', {
      data: { messageId: uid() },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
