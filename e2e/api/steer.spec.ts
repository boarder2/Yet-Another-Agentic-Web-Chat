import { test, expect } from '../fixtures/api';
import { baseURL, uid } from '../utils/helpers';
import {
  eventsOfType,
  joinResponseText,
  streamChatUntil,
  type ChatEvent,
} from '../utils/sse';

function chatBody(model: string, content: string) {
  return {
    message: { messageId: uid(), chatId: uid(), content },
    focusMode: 'webSearch',
    files: [],
    chatModel: { provider: 'test', name: model },
    systemModel: { provider: 'test', name: model },
    selectedSystemPromptIds: [],
  };
}

/**
 * Stream a chat turn to its end, running `onFirstText` once the first response
 * text arrives — the moment the agent's first model call is known to be under
 * way.
 */
function streamWithSteer(
  body: ReturnType<typeof chatBody>,
  onFirstText: () => Promise<void>,
): Promise<ChatEvent[]> {
  let steered = false;
  return streamChatUntil(
    baseURL(),
    body,
    async (events) => {
      if (!steered && joinResponseText(events)) {
        steered = true;
        await onFirstText();
      }
      return false;
    },
    30_000,
  );
}

test.describe('/api/chat/steer', () => {
  test('rejects malformed requests and runs that are not live', async ({
    request,
  }) => {
    const missing = await request.post('/api/chat/steer', {
      data: { messageId: uid() },
    });
    expect(missing.status()).toBe(400);

    const notLive = await request.post('/api/chat/steer', {
      data: { messageId: uid(), content: 'go left' },
    });
    expect(notLive.status()).toBe(409);

    const remove = await request.delete('/api/chat/steer', {
      data: { messageId: uid(), steerId: 'nope' },
    });
    expect(remove.status()).toBe(409);
  });

  test('a steer queued mid-step reaches the next model call and persists inline', async ({
    request,
  }) => {
    const body = chatBody('test-steer', 'Summarize the documents');
    const events = await streamWithSteer(body, async () => {
      const res = await request.post('/api/chat/steer', {
        data: { messageId: body.message.messageId, content: 'Only cover 2024' },
      });
      expect(res.status()).toBe(200);
    });

    expect(eventsOfType(events, 'steer_queued')).toHaveLength(1);
    expect(eventsOfType(events, 'steer_applied')).toHaveLength(1);
    expect(eventsOfType(events, 'followup_turn_started')).toHaveLength(0);
    expect(joinResponseText(events)).toContain('Acting on: Only cover 2024');

    const chat = await (
      await request.get(`/api/chats/${body.message.chatId}`)
    ).json();
    const assistant = chat.messages.find(
      (m: { role: string }) => m.role === 'assistant',
    ).content as string;
    // The steer lands after the tool call it waited for, before the answer.
    const tool = assistant.indexOf('```yaawc:tool_call');
    const steerAt = assistant.indexOf('```yaawc:steer');
    expect(tool).toBeGreaterThan(-1);
    expect(steerAt).toBeGreaterThan(tool);
    expect(assistant.indexOf('Acting on: Only cover 2024')).toBeGreaterThan(
      steerAt,
    );
  });

  test('a steer the agent cannot receive starts the next turn', async ({
    request,
  }) => {
    const body = chatBody('test-slow', 'Answer slowly');
    const events = await streamWithSteer(body, async () => {
      const res = await request.post('/api/chat/steer', {
        data: {
          messageId: body.message.messageId,
          content: 'Now answer in French',
        },
      });
      expect(res.status()).toBe(200);
    });

    expect(eventsOfType(events, 'steer_applied')).toHaveLength(0);
    const messageEnd = eventsOfType(events, 'messageEnd')[0];
    expect(messageEnd.followupPending).toBe(true);
    const [followup] = eventsOfType(events, 'followup_turn_started');
    expect(followup.data).toMatchObject({ content: 'Now answer in French' });

    await expect
      .poll(
        async () => {
          const chat = await (
            await request.get(`/api/chats/${body.message.chatId}`)
          ).json();
          return {
            users: chat.messages
              .filter((m: { role: string }) => m.role === 'user')
              .map((m: { content: string }) => m.content),
            idle: chat.chat.activeRunMessageId === null,
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({
        users: ['Answer slowly', 'Now answer in French'],
        idle: true,
      });
  });
});
