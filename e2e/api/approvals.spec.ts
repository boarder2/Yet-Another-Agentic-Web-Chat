import { test, expect } from '../fixtures/api';
import {
  seedChat,
  seedAwaitingApproval,
  cancelAwaitingRun,
} from '../utils/seed';

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

  test('returns a real pending approval with its question and options', async ({
    request,
  }) => {
    const { chatId, messageId, approvalId, question } =
      await seedAwaitingApproval({ content: 'approvals-real-data' });

    const res = await request.get(`/api/approvals/pending?chatId=${chatId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.pending.length).toBe(1);
    const approval = body.pending[0];
    expect(approval.approvalId).toBe(approvalId);
    expect(approval.chatId).toBe(chatId);
    expect(approval.messageId).toBe(messageId);
    expect(approval.toolKind).toBe('ask_user');
    expect(approval.payload.question).toBe(question);
    expect(approval.payload.question).toBe('Which color do you prefer?');
    expect(approval.payload.options).toEqual([
      { label: 'Red' },
      { label: 'Blue' },
    ]);
    expect(approval.payload.multiSelect).toBe(false);
    expect(approval.payload.allowFreeformInput).toBe(true);

    await cancelAwaitingRun(request, { messageId, chatId });
  });

  test('scopes pending approvals by chatId — an unrelated chat sees none', async ({
    request,
  }) => {
    const { chatId, messageId } = await seedAwaitingApproval({
      content: 'approvals-scoping',
    });
    const otherChatId = await seedChat(request, {
      content: 'unrelated chat',
    });

    const otherRes = await request.get(
      `/api/approvals/pending?chatId=${otherChatId}`,
    );
    expect((await otherRes.json()).pending).toEqual([]);

    const mineRes = await request.get(
      `/api/approvals/pending?chatId=${chatId}`,
    );
    const mineBody = await mineRes.json();
    expect(mineBody.pending.length).toBe(1);
    expect(mineBody.pending[0].chatId).toBe(chatId);

    await cancelAwaitingRun(request, { messageId, chatId });
  });
});
