import { test, expect } from '../fixtures/api';
import type { APIRequestContext } from '@playwright/test';
import { uid, uniq } from '../utils/helpers';
import { seedWorkspace, seedWorkspaceFile } from '../utils/seed';
import { collectSseEvents, eventsOfType, type ChatEvent } from '../utils/sse';

interface PostChatResult {
  status: number;
  events: ChatEvent[];
  body: () => Promise<unknown>;
}

/** POST /api/chat, letting the caller fully control chatModel/systemModel. */
async function postChatRaw(
  request: APIRequestContext,
  overrides: Partial<{
    chatId: string;
    content: string;
    focusMode: string;
    workspaceId: string;
    chatModel: { provider: string; name: string };
    systemModel: { provider: string; name: string };
  }>,
): Promise<PostChatResult> {
  const chatId = overrides.chatId ?? uid();
  const messageId = uid();
  const res = await request.post('/api/chat', {
    data: {
      message: {
        messageId,
        chatId,
        content: overrides.content ?? 'Hello',
      },
      focusMode: overrides.focusMode ?? 'webSearch',
      files: [],
      chatModel: overrides.chatModel ?? {
        provider: 'test',
        name: 'test-direct',
      },
      systemModel: overrides.systemModel ?? {
        provider: 'test',
        name: 'test-direct',
      },
      selectedSystemPromptIds: [],
      workspaceId: overrides.workspaceId ?? null,
    },
  });
  const status = res.status();
  const events = status === 200 ? await collectSseEvents(res) : [];
  return { status, events, body: () => res.json() };
}

test.describe('POST /api/chat — workspace model override', () => {
  test('a workspace-pinned model overrides the client-sent model', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: uniq('override-ws'),
      modelOverride: {
        chatProvider: 'test',
        chatModel: 'test-tool',
        systemProvider: 'test',
        systemModel: 'test-direct',
        imageCapable: false,
        contextWindowSize: 32768,
      },
    });
    await seedWorkspaceFile(request, wsId, {
      name: `${uniq('doc')}.txt`,
      content: 'The capital of France is Paris.',
    });

    const { status, events } = await postChatRaw(request, {
      content: 'What is the capital of France?',
      focusMode: 'localResearch',
      workspaceId: wsId,
      // Deliberately different from the pin — the server must discard this.
      chatModel: { provider: 'test', name: 'test-direct' },
      systemModel: { provider: 'test', name: 'test-direct' },
    });

    expect(status).toBe(200);
    // Only test-tool ever emits a tool_call_started event; test-direct never does.
    expect(
      eventsOfType(events, 'tool_call_started').length,
    ).toBeGreaterThanOrEqual(1);
  });

  test('an invalid pinned model is a hard error', async ({ request }) => {
    const wsId = await seedWorkspace(request, {
      name: uniq('invalid-override-ws'),
      modelOverride: {
        chatProvider: 'nonexistent_provider',
        chatModel: 'nonexistent_model',
        systemProvider: 'nonexistent_provider',
        systemModel: 'nonexistent_model',
      },
    });

    const { status, body } = await postChatRaw(request, {
      workspaceId: wsId,
    });

    expect(status).toBe(400);
    const parsed = (await body()) as { error: string };
    expect(parsed.error).toBe(
      "This workspace's pinned model is no longer available. Update it in workspace settings.",
    );
  });

  test('a workspace with no override leaves the client-sent model in effect', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request, { name: uniq('plain-ws') });
    await seedWorkspaceFile(request, wsId, {
      name: `${uniq('doc')}.txt`,
      content: 'The sky is blue.',
    });

    const { status, events } = await postChatRaw(request, {
      content: 'What color is the sky?',
      focusMode: 'localResearch',
      workspaceId: wsId,
      chatModel: { provider: 'test', name: 'test-tool' },
      systemModel: { provider: 'test', name: 'test-tool' },
    });

    expect(status).toBe(200);
    expect(
      eventsOfType(events, 'tool_call_started').length,
    ).toBeGreaterThanOrEqual(1);
  });
});
