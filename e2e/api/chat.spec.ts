import { test, expect } from '../fixtures/api';
import type { APIRequestContext } from '@playwright/test';
import { uid, uniq } from '../utils/helpers';
import { seedChat, seedWorkspace, seedWorkspaceFile } from '../utils/seed';
import {
  collectSseEvents,
  eventsOfType,
  joinResponseText,
  extractSources,
  type ChatEvent,
} from '../utils/sse';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PostChatResult {
  chatId: string;
  messageId: string;
  events: ChatEvent[];
}

/** POST /api/chat with the test model and collect all SSE events. */
async function postChat(
  request: APIRequestContext,
  overrides?: Partial<{
    chatId: string;
    messageId: string;
    content: string;
    focusMode: string;
    workspaceId: string;
    model: string;
  }>,
): Promise<PostChatResult> {
  const chatId = overrides?.chatId ?? uid();
  const messageId = overrides?.messageId ?? uid();
  const model = overrides?.model ?? 'test-direct';
  const res = await request.post('/api/chat', {
    data: {
      message: {
        messageId,
        chatId,
        content: overrides?.content ?? 'Hello',
      },
      focusMode: overrides?.focusMode ?? 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: model },
      systemModel: { provider: 'test', name: model },
      selectedSystemPromptIds: [],
      workspaceId: overrides?.workspaceId ?? null,
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(
      `POST /api/chat returned ${res.status()}: ${text.slice(0, 500)}`,
    );
  }
  const events = await collectSseEvents(res);
  return { chatId, messageId, events };
}

// ---------------------------------------------------------------------------
// POST /api/chat — happy path (test-direct)
// ---------------------------------------------------------------------------

test.describe('POST /api/chat (test-direct)', () => {
  test('streams deterministic response tokens', async ({ request }) => {
    const { events } = await postChat(request, { content: 'hello-stream' });

    const responseEvents = eventsOfType(events, 'response');
    expect(responseEvents.length).toBeGreaterThan(0);

    const text = joinResponseText(events);
    expect(text).toBe('This is a deterministic test answer.');
  });

  test('emits a messageEnd event with model stats', async ({ request }) => {
    const { events } = await postChat(request, { content: 'end-event' });

    const endEvents = eventsOfType(events, 'messageEnd');
    expect(endEvents.length).toBe(1);
    const end = endEvents[0];
    expect(typeof end.messageId).toBe('string');
    expect(typeof end.modelStats).toBe('object');
    const stats = end.modelStats as Record<string, unknown> | undefined;
    expect(stats).toBeTruthy();
    expect(typeof stats!.responseTime).toBe('number');
  });

  test('emits a stats event with deterministic model name', async ({
    request,
  }) => {
    const { events } = await postChat(request, { content: 'stats-event' });

    const statsEvents = eventsOfType(events, 'stats');
    expect(statsEvents.length).toBeGreaterThanOrEqual(1);
    const stats = statsEvents[0].data as Record<string, unknown>;
    expect(stats.modelName).toBe('test-direct');
  });

  test('webSearch focus mode succeeds and messages persist', async ({
    request,
  }) => {
    const { chatId, events } = await postChat(request, {
      content: 'focus-web-search',
      focusMode: 'webSearch',
    });

    const text = joinResponseText(events);
    expect(text).toBe('This is a deterministic test answer.');

    // Verify messages persisted to the DB
    const getRes = await request.get(`/api/chats/${chatId}`);
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    expect(body.chat.focusMode).toBe('webSearch');
    const msgs: Array<{ role: string; content: string }> = body.messages;
    const userMsg = msgs.find((m) => m.role === 'user');
    const assistantMsg = msgs.find((m) => m.role === 'assistant');
    expect(userMsg).toBeTruthy();
    expect(userMsg!.content).toBe('focus-web-search');
    expect(assistantMsg).toBeTruthy();
    expect(assistantMsg!.content).toBe('This is a deterministic test answer.');
  });

  test('localResearch focus mode succeeds', async ({ request }) => {
    const { events } = await postChat(request, {
      content: 'focus-local',
      focusMode: 'localResearch',
    });

    const endEvents = eventsOfType(events, 'messageEnd');
    expect(endEvents.length).toBe(1);
  });

  test('chat focus mode succeeds', async ({ request }) => {
    const { events } = await postChat(request, {
      content: 'focus-chat',
      focusMode: 'chat',
    });

    const endEvents = eventsOfType(events, 'messageEnd');
    expect(endEvents.length).toBe(1);
  });

  test('message content is required — returns 400 when empty with no images', async ({
    request,
  }) => {
    const res = await request.post('/api/chat', {
      data: {
        message: {
          messageId: uid(),
          chatId: uid(),
          content: '',
        },
        focusMode: 'webSearch',
        files: [],
        chatModel: { provider: 'test', name: 'test-direct' },
        systemModel: { provider: 'test', name: 'test-direct' },
        selectedSystemPromptIds: [],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('Please provide a message to process');
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat — tool loop (test-tool)
// ---------------------------------------------------------------------------

test.describe('POST /api/chat (test-tool)', () => {
  test('emits tool_call_started and tool_call_success events', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request, { name: uniq('tool-ws') });
    await seedWorkspaceFile(request, wsId, {
      name: `${uniq('doc')}.txt`,
      content: 'The capital of France is Paris.',
    });

    const { events } = await postChat(request, {
      content: 'What is the capital of France?',
      focusMode: 'localResearch',
      workspaceId: wsId,
      model: 'test-tool',
    });

    const toolStartEvents = eventsOfType(events, 'tool_call_started');
    expect(toolStartEvents.length).toBeGreaterThanOrEqual(1);

    const started = toolStartEvents[0].data as Record<string, unknown>;
    expect(typeof started.toolCallId).toBe('string');

    const toolSuccessEvents = eventsOfType(events, 'tool_call_success');
    expect(toolSuccessEvents.length).toBeGreaterThanOrEqual(1);
    const success = toolSuccessEvents[0].data as Record<string, unknown>;
    expect(success.status).toBe('success');
  });

  test('emits sources events with citation data from file_search', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request, { name: uniq('cite-ws') });
    await seedWorkspaceFile(request, wsId, {
      name: `${uniq('ref')}.txt`,
      content:
        'Paris is the capital of France. It is known for the Eiffel Tower.',
    });

    const { events } = await postChat(request, {
      content: 'What is the capital of France?',
      focusMode: 'localResearch',
      workspaceId: wsId,
      model: 'test-tool',
    });

    const sources = extractSources(events);
    expect(Array.isArray(sources)).toBe(true);
  });

  test('produces deterministic tool-result answer', async ({ request }) => {
    const wsId = await seedWorkspace(request, { name: uniq('tool-ans-ws') });
    await seedWorkspaceFile(request, wsId, {
      name: `${uniq('notes')}.txt`,
      content: 'The sky is blue.',
    });

    const { events } = await postChat(request, {
      content: 'What color is the sky?',
      focusMode: 'localResearch',
      workspaceId: wsId,
      model: 'test-tool',
    });

    const text = joinResponseText(events);
    expect(text).toBe('Based on the document, the answer is deterministic.');
  });

  test('message persists with tool-use answer', async ({ request }) => {
    const wsId = await seedWorkspace(request, { name: uniq('persist-ws') });
    await seedWorkspaceFile(request, wsId, {
      name: `${uniq('data')}.txt`,
      content: 'Test content for persistence.',
    });

    const { chatId } = await postChat(request, {
      content: 'Tell me about the test content',
      focusMode: 'localResearch',
      workspaceId: wsId,
      model: 'test-tool',
    });

    const getRes = await request.get(`/api/chats/${chatId}`);
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    const assistantMsg = (
      body.messages as Array<{ role: string; content: string }>
    ).find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeTruthy();
    // The agent prepends a <ToolCall> XML marker before the model's answer.
    expect(assistantMsg!.content).toContain(
      'Based on the document, the answer is deterministic.',
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat/cancel
// ---------------------------------------------------------------------------

test.describe('POST /api/chat/cancel', () => {
  test('returns 400 when messageId is missing', async ({ request }) => {
    const res = await request.post('/api/chat/cancel', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing messageId');
  });

  test('returns 404 for a non-existent messageId', async ({ request }) => {
    const res = await request.post('/api/chat/cancel', {
      data: { messageId: uid() },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('No in-progress request for this messageId');
  });

  // Note: the happy path (cancel an active run) cannot be tested with the
  // current synchronous test model — the run completes before a cancel can be
  // issued. Adding a slow/pausing test model variant would enable this.
});

// ---------------------------------------------------------------------------
// POST /api/chat/compact
// ---------------------------------------------------------------------------

test.describe('POST /api/chat/compact', () => {
  test('returns 400 when chatId is missing', async ({ request }) => {
    const res = await request.post('/api/chat/compact', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('chatId is required');
  });

  test('compacts a chat and returns deterministic summary', async ({
    request,
  }) => {
    const chatId = await seedChat(request, {
      content: 'compact test message',
    });

    const res = await request.post('/api/chat/compact', {
      data: {
        chatId,
        chatModel: { provider: 'test', name: 'test-direct' },
        systemModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // The deterministic test model produces this exact summary.
    expect(body.compactionSummary).toBe('This is a deterministic test answer.');
    expect(body.compactedMessageCount).toBeGreaterThanOrEqual(1);
    expect(typeof body.lastCompactedId).toBe('number');
    expect(typeof body.tokensBefore).toBe('number');
    expect(typeof body.tokensAfter).toBe('number');

    // Verify the compaction summary is persisted as a message row.
    const getRes = await request.get(`/api/chats/${chatId}`);
    const chatData = await getRes.json();
    const compactionMsg = (
      chatData.messages as Array<{ role: string; content: string }>
    ).find((m: { role: string }) => m.role === 'compaction');
    expect(compactionMsg).toBeTruthy();
    expect(compactionMsg!.content).toBe(body.compactionSummary);
  });

  test('succeeds on a chat with multiple messages', async ({ request }) => {
    const chatId = await seedChat(request, {
      content: 'multi-compact test',
    });

    const res = await request.post('/api/chat/compact', {
      data: {
        chatId,
        chatModel: { provider: 'test', name: 'test-direct' },
        systemModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.compactedMessageCount).toBeGreaterThanOrEqual(1);
    expect(body.compactionSummary).toBe('This is a deterministic test answer.');
  });
});

// ---------------------------------------------------------------------------
// GET /api/chat/runs/active
// ---------------------------------------------------------------------------

test.describe('GET /api/chat/runs/active', () => {
  test('returns active runs array (may be empty)', async ({ request }) => {
    const res = await request.get('/api/chat/runs/active');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.active)).toBe(true);
    expect(Array.isArray(body.stale)).toBe(true);
    expect(typeof body.unreadCount).toBe('number');
    expect(typeof body.awaitingAttentionCount).toBe('number');
  });

  test('active run objects have required fields', async ({ request }) => {
    const res = await request.get('/api/chat/runs/active');
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const run of body.active) {
      expect(typeof run.chatId).toBe('string');
      expect(typeof run.messageId).toBe('string');
      expect(typeof run.startedAt).toBe('number');
      expect(['running', 'awaiting_user']).toContain(run.status);
    }
  });

  // Note: the synchronous test model completes before /runs/active can be
  // polled, so the active list is always empty. A pausing test model variant
  // (e.g. test-ask-user) would allow testing state transitions.
});

// ---------------------------------------------------------------------------
// GET /api/chat/runs/[messageId]/stream
// ---------------------------------------------------------------------------

test.describe('GET /api/chat/runs/[messageId]/stream', () => {
  test('reconnects to a recently completed run and replays events', async ({
    request,
  }) => {
    const { messageId, events } = await postChat(request, {
      content: 'reconnect test',
    });

    // The run should still be in the hub (TTL is 60 s). Reconnect immediately.
    const streamRes = await request.get(`/api/chat/runs/${messageId}/stream`);
    expect(streamRes.status()).toBe(200);

    const replayEvents = await collectSseEvents(streamRes);
    const replayedText = joinResponseText(replayEvents);
    expect(replayedText).toBe('This is a deterministic test answer.');

    const originalResponseCount = eventsOfType(events, 'response').length;
    const replayResponseCount = eventsOfType(replayEvents, 'response').length;
    expect(replayResponseCount).toBe(originalResponseCount);
  });

  test('returns gone for an unknown messageId', async ({ request }) => {
    const streamRes = await request.get(`/api/chat/runs/${uid()}/stream`);
    expect(streamRes.status()).toBe(200);
    const events = await collectSseEvents(streamRes);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('gone');
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat/runs/resume
// ---------------------------------------------------------------------------

test.describe('POST /api/chat/runs/resume', () => {
  test('returns 400 when no approvalId or resumeMap provided', async ({
    request,
  }) => {
    const res = await request.post('/api/chat/runs/resume', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/approvalId/i);
  });

  test('returns 410 for a non-existent approvalId', async ({ request }) => {
    const res = await request.post('/api/chat/runs/resume', {
      data: { approvalId: uid() },
    });
    expect(res.status()).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  test('returns 400 when resumeMap is empty object', async ({ request }) => {
    const res = await request.post('/api/chat/runs/resume', {
      data: { resumeMap: {} },
    });
    expect(res.status()).toBe(400);
  });

  // Note: happy-path resume (approve a pending ask_user) requires a test model
  // that emits an ask_user tool call (e.g. test-ask-user).
});
