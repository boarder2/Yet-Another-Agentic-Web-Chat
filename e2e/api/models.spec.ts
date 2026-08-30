import { test, expect, type APIRequestContext } from '../fixtures/api';
import { uid } from '../utils/helpers';
import { collectSseEvents, eventsOfType } from '../utils/sse';

type ModelRef = {
  provider: string;
  name: string;
  reasoningEffort?: string;
};

function chatBody(
  chatModel: ModelRef,
  systemModel: ModelRef = chatModel,
): { chatId: string; body: Record<string, unknown> } {
  const chatId = uid();
  return {
    chatId,
    body: {
      message: {
        messageId: uid(),
        chatId,
        content: 'reasoning effort integration test',
      },
      focusMode: 'chat',
      files: [],
      chatModel,
      systemModel,
      selectedSystemPromptIds: [],
    },
  };
}

async function runChat(
  request: APIRequestContext,
  chatModel: ModelRef,
  systemModel: ModelRef = chatModel,
) {
  const { chatId, body } = chatBody(chatModel, systemModel);
  const response = await request.post('/api/chat', { data: body });
  expect(response.status()).toBe(200);
  return { chatId, events: await collectSseEvents(response) };
}

async function assistantMetadata(
  request: APIRequestContext,
  chatId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`/api/chats/${chatId}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  const assistant = (
    body.messages as Array<{ role: string; metadata?: string }>
  )
    .filter((message) => message.role === 'assistant')
    .at(-1);
  return JSON.parse(assistant?.metadata ?? '{}') as Record<string, unknown>;
}

test.describe('reasoning effort integration contracts', () => {
  test('serializes model capabilities and omits unsupported capability metadata', async ({
    request,
  }) => {
    const response = await request.get('/api/models');
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.chatModelProviders.test['test-reasoning']).toEqual({
      displayName: 'Test (reasoning)',
      supportedReasoningEfforts: ['off', 'low', 'medium', 'high'],
    });
    expect(body.chatModelProviders.test['test-direct']).toEqual({
      displayName: 'Test (direct)',
    });
  });

  test('returns HTTP 400 for an invalid reasoning effort', async ({
    request,
  }) => {
    const { body } = chatBody({
      provider: 'test',
      name: 'test-reasoning',
      reasoningEffort: 'default',
    });
    const response = await request.post('/api/chat', { data: body });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Invalid reasoning effort'),
    });
  });

  test('keeps Provider default absent from live and persisted model metadata', async ({
    request,
  }) => {
    const { chatId, events } = await runChat(request, {
      provider: 'test',
      name: 'test-reasoning',
    });
    const messageEnd = eventsOfType(events, 'messageEnd').at(-1);

    expect(messageEnd?.modelConfig).toEqual({
      chat: { provider: 'test', name: 'test-reasoning' },
      system: { provider: 'test', name: 'test-reasoning' },
    });
    expect(messageEnd?.modelConfig).not.toHaveProperty('chat.reasoningEffort');
    expect(await assistantMetadata(request, chatId)).toMatchObject({
      modelConfig: messageEnd?.modelConfig,
    });
  });

  test('clamps stale effort to the nearest native level without rewriting model identity', async ({
    request,
  }) => {
    const { chatId, events } = await runChat(request, {
      provider: 'test',
      name: 'test-reasoning',
      reasoningEffort: 'xhigh',
    });
    const expected = {
      chat: {
        provider: 'test',
        name: 'test-reasoning',
        reasoningEffort: 'high',
      },
      system: {
        provider: 'test',
        name: 'test-reasoning',
        reasoningEffort: 'high',
      },
    };
    const messageEnd = eventsOfType(events, 'messageEnd').at(-1);

    expect(messageEnd?.modelConfig).toEqual(expected);
    expect(await assistantMetadata(request, chatId)).toMatchObject({
      modelConfig: expected,
    });
  });

  test('treats requested effort on an unsupported model as Provider default', async ({
    request,
  }) => {
    const { chatId, events } = await runChat(request, {
      provider: 'test',
      name: 'test-direct',
      reasoningEffort: 'high',
    });
    const expected = {
      chat: { provider: 'test', name: 'test-direct' },
      system: { provider: 'test', name: 'test-direct' },
    };
    const messageEnd = eventsOfType(events, 'messageEnd').at(-1);

    expect(messageEnd?.modelConfig).toEqual(expected);
    expect(await assistantMetadata(request, chatId)).toMatchObject({
      modelConfig: expected,
    });
  });

  test('persists independently resolved Chat and System effort', async ({
    request,
  }) => {
    const { chatId, events } = await runChat(
      request,
      {
        provider: 'test',
        name: 'test-reasoning',
        reasoningEffort: 'high',
      },
      {
        provider: 'test',
        name: 'test-reasoning',
        reasoningEffort: 'low',
      },
    );
    const expected = {
      chat: {
        provider: 'test',
        name: 'test-reasoning',
        reasoningEffort: 'high',
      },
      system: {
        provider: 'test',
        name: 'test-reasoning',
        reasoningEffort: 'low',
      },
    };
    const messageEnd = eventsOfType(events, 'messageEnd').at(-1);

    expect(messageEnd?.modelConfig).toEqual(expected);
    expect(await assistantMetadata(request, chatId)).toMatchObject({
      modelConfig: expected,
    });
  });
});
