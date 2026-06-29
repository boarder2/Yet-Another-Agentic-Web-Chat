import { test, expect } from '../fixtures/api';

test.describe('GET /api/approvals/pending', () => {
  test('returns a pending array', async ({ request }) => {
    const res = await request.get('/api/approvals/pending');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.pending)).toBe(true);
  });

  test('pending items have required fields', async ({ request }) => {
    const res = await request.get('/api/approvals/pending');
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const item of body.pending) {
      expect(typeof item.approvalId).toBe('string');
      expect(typeof item.chatId).toBe('string');
      expect(typeof item.messageId).toBe('string');
      expect(typeof item.toolKind).toBe('string');
      expect(typeof item.createdAt).toBe('number');
    }
  });
});
