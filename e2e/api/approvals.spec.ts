import { test, expect } from '../fixtures/api';
import {
  seedChat,
  seedAwaitingApproval,
  cancelAwaitingRun,
} from '../utils/seed';

test.describe('GET /api/approvals/pending', () => {
  // The unfiltered endpoint returns pending approvals across every chat, so its
  // result can't be asserted empty in a shared-DB parallel run — other specs
  // seed approvals concurrently. Assert the branch's real contract instead: our
  // seeded approval appears in the global list. ("Empty when none" is covered,
  // isolatably, by the chatId-filtered cases below.)
  test('lists a pending approval in the unfiltered (all-chats) result', async ({
    request,
  }) => {
    const { chatId, messageId, approvalId } = await seedAwaitingApproval({
      content: 'approvals-global-list',
    });

    const res = await request.get('/api/approvals/pending');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.pending)).toBe(true);
    const mine = body.pending.find(
      (a: { approvalId: string }) => a.approvalId === approvalId,
    );
    expect(mine?.chatId).toBe(chatId);

    await cancelAwaitingRun(request, { messageId, chatId });
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
