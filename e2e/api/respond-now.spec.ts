import { test, expect } from '../fixtures/api';
import { uid } from '../utils/helpers';
import {
  seedChat,
  seedAwaitingApproval,
  cancelAwaitingRun,
} from '../utils/seed';

test.describe('POST /api/respond-now', () => {
  test('returns 400 when messageId is missing', async ({ request }) => {
    const res = await request.post('/api/respond-now', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing messageId');
  });

  test('returns 400 when body is not valid JSON', async ({ request }) => {
    const res = await request.post('/api/respond-now', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not valid json',
    });
    expect(res.status()).toBe(400);
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

  test('succeeds for a messageId from a completed chat run', async ({
    request,
  }) => {
    const chatId = await seedChat(request, {
      content: 'respond-now test',
    });

    // Fetch the chat to get the messageId of the user message
    const getRes = await request.get(`/api/chats/${chatId}`);
    expect(getRes.status()).toBe(200);
    const chatData = await getRes.json();
    const userMsg = (
      chatData.messages as Array<{ role: string; messageId: string }>
    ).find((m) => m.role === 'user');
    expect(userMsg).toBeTruthy();

    const res = await request.post('/api/respond-now', {
      data: { messageId: userMsg!.messageId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('succeeds for a genuinely in-flight (awaiting_user) run', async ({
    request,
  }) => {
    const { chatId, messageId } = await seedAwaitingApproval({
      content: 'respond-now-in-flight',
    });

    const res = await request.post('/api/respond-now', {
      data: { messageId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    await cancelAwaitingRun(request, { messageId, chatId });
  });
});
