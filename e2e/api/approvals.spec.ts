import { test, expect } from '../fixtures/api';
import { seedChat } from '../utils/seed';

test.describe('GET /api/approvals/pending', () => {
  test('returns empty pending array when no approvals exist', async ({
    request,
  }) => {
    const res = await request.get('/api/approvals/pending');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.pending)).toBe(true);
    expect(body.pending).toEqual([]);
  });

  test('filters by chatId query param (empty result for chat with no approvals)', async ({
    request,
  }) => {
    const chatId = await seedChat(request, {
      content: 'approvals filter test',
    });

    const res = await request.get(`/api/approvals/pending?chatId=${chatId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.pending)).toBe(true);
    // The seeded chat has no pending approvals — array must be empty.
    expect(body.pending).toEqual([]);
  });

  // Full coverage of the approvals/pending endpoint requires seeding actual
  // approval_request rows, which can only be created by the agent when it hits
  // an interrupt (e.g. ask_user tool call). The current test model variants
  // (test-direct, test-tool) don't emit interrupts. A test-ask-user model
  // variant would unlock:
  //   - Non-empty pending array with real field values
  //   - chatId filter returning matching vs. non-matching rows
  //   - Multiple pending approvals with distinct toolKinds
});
