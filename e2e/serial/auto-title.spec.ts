import { test, expect } from '../fixtures';
import type { APIRequestContext } from '@playwright/test';
import { uid } from '../utils/helpers';
import { seedScheduledChat } from '../utils/seed';
import { collectSseEvents, eventsOfType, type ChatEvent } from '../utils/sse';

// autoTitleEnabled is a DB-synced, instance-wide setting (seeded OFF for the
// suite). These tests flip it, so they live in the single-worker `serial`
// project and reset it after each test.

async function setAutoTitle(request: APIRequestContext, on: boolean) {
  const res = await request.patch('/api/settings', {
    data: { autoTitleEnabled: String(on) },
  });
  expect(res.ok()).toBe(true);
}

/** POST /api/chat with the test model; return the collected SSE events. */
async function postChat(
  request: APIRequestContext,
  opts: {
    chatId: string;
    messageId: string;
    content: string;
    systemModel?: string;
  },
): Promise<ChatEvent[]> {
  const res = await request.post('/api/chat', {
    data: {
      message: {
        messageId: opts.messageId,
        chatId: opts.chatId,
        content: opts.content,
      },
      focusMode: 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: 'test-direct' },
      systemModel: {
        provider: 'test',
        name: opts.systemModel ?? 'test-direct',
      },
      selectedSystemPromptIds: [],
      workspaceId: null,
    },
  });
  if (!res.ok()) {
    throw new Error(`POST /api/chat returned ${res.status()}`);
  }
  return collectSseEvents(res);
}

async function getChat(request: APIRequestContext, chatId: string) {
  const res = await request.get(`/api/chats/${chatId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.chat as {
    title: string;
    titleLocked: number;
    scheduleId: string | null;
  };
}

test.describe('auto-generated chat titles', () => {
  test.afterEach(async ({ request }) => {
    await setAutoTitle(request, false);
  });

  test('first-turn completion generates a title and pushes a chatTitle event', async ({
    request,
  }) => {
    await setAutoTitle(request, true);
    const chatId = uid();
    const messageId = uid();

    const events = await postChat(request, {
      chatId,
      messageId,
      content: 'How do ocean tides work?',
    });

    const titleEvents = eventsOfType(events, 'chatTitle');
    expect(titleEvents.length).toBe(1);
    expect(titleEvents[0].title).toBe('Deterministic Test Title');
    expect(titleEvents[0].chatId).toBe(chatId);

    const chat = await getChat(request, chatId);
    expect(chat.title).toBe('Deterministic Test Title');
    // Auto-generated titles are not locked.
    expect(chat.titleLocked).toBe(0);
  });

  test('a manual rename locks the title against regeneration', async ({
    request,
  }) => {
    await setAutoTitle(request, true);
    const chatId = uid();
    const messageId = uid();

    await postChat(request, {
      chatId,
      messageId,
      content: 'Original question',
    });

    const patch = await request.patch(`/api/chats/${chatId}`, {
      data: { title: 'My Manual Title' },
    });
    expect(patch.ok()).toBe(true);

    let chat = await getChat(request, chatId);
    expect(chat.title).toBe('My Manual Title');
    expect(chat.titleLocked).toBe(1);

    // Edit the first message and re-run: a locked title must survive, and no
    // chatTitle event is emitted.
    const events = await postChat(request, {
      chatId,
      messageId,
      content: 'Edited question',
    });
    expect(eventsOfType(events, 'chatTitle').length).toBe(0);

    chat = await getChat(request, chatId);
    expect(chat.title).toBe('My Manual Title');
  });

  test('editing the first message regenerates an unlocked title', async ({
    request,
  }) => {
    await setAutoTitle(request, true);
    const chatId = uid();
    const messageId = uid();

    const first = await postChat(request, {
      chatId,
      messageId,
      content: 'First version',
    });
    expect(eventsOfType(first, 'chatTitle').length).toBe(1);

    // Edit + re-run: still unlocked, so the title regenerates (another event).
    const second = await postChat(request, {
      chatId,
      messageId,
      content: 'Second version',
    });
    expect(eventsOfType(second, 'chatTitle').length).toBe(1);

    const chat = await getChat(request, chatId);
    expect(chat.title).toBe('Deterministic Test Title');
    expect(chat.titleLocked).toBe(0);
  });

  test('with the setting off, the title stays the raw first message', async ({
    request,
  }) => {
    await setAutoTitle(request, false);
    const chatId = uid();
    const messageId = uid();
    const content = `raw-title-${Date.now()}`;

    const events = await postChat(request, { chatId, messageId, content });
    expect(eventsOfType(events, 'chatTitle').length).toBe(0);

    const chat = await getChat(request, chatId);
    expect(chat.title).toBe(content);
  });

  test('an empty title result keeps the raw first message', async ({
    request,
  }) => {
    await setAutoTitle(request, true);
    const chatId = uid();
    const messageId = uid();
    const content = `notitle-${Date.now()}`;

    // The `test-notitle` system model returns an empty title, so generation is
    // skipped and the raw first-message title is retained.
    const events = await postChat(request, {
      chatId,
      messageId,
      content,
      systemModel: 'test-notitle',
    });
    expect(eventsOfType(events, 'chatTitle').length).toBe(0);

    const chat = await getChat(request, chatId);
    expect(chat.title).toBe(content);
  });

  test('scheduled-run chats are never auto-titled', async ({ request }) => {
    await setAutoTitle(request, true);
    const chatId = await seedScheduledChat(request, {
      taskName: 'Nightly digest',
      prompt: 'Summarize the news',
    });

    const chat = await getChat(request, chatId);
    expect(chat.scheduleId).toBeTruthy();
    // The scheduled runner sets its own purposeful title and never auto-titles.
    expect(chat.title).not.toBe('Deterministic Test Title');
    expect(chat.title).toContain('Nightly digest');
  });
});
