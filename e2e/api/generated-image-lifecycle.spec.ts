import { test, expect } from '../fixtures/api';
import { runImageGenerationTurn, seedWorkspace } from '../utils/seed';
import { uid, uniq } from '../utils/helpers';
import { joinResponseText } from '../utils/sse';

type HistoryImage = {
  id: string;
  type: 'image';
  extension: string;
  mimeType: string;
  prompt: string;
  assistantMessageId: string;
  chatId: string | null;
  workspaceId: string | null;
  chatTitle: string | null;
  imageUrl: string;
};

async function imageFromHistory(
  request: Parameters<typeof runImageGenerationTurn>[0],
  imageId: string,
): Promise<HistoryImage> {
  const response = await request.get('/api/artifacts?type=images');
  expect(response.status()).toBe(200);
  const rows = (await response.json()) as HistoryImage[];
  const row = rows.find((candidate) => candidate.id === imageId);
  expect(row).toBeTruthy();
  return row!;
}

async function imageIdFromEvents(
  events: Array<{ type: string; data?: unknown }>,
): Promise<string> {
  const success = events.find((event) => {
    if (event.type !== 'tool_call_success') return false;
    const data = event.data as { extra?: { imageId?: unknown } } | undefined;
    return typeof data?.extra?.imageId === 'string';
  });
  const imageId = (
    success?.data as { extra?: { imageId?: unknown } } | undefined
  )?.extra?.imageId;
  expect(imageId).toEqual(expect.any(String));
  return imageId as string;
}

test.describe('generated image persistence and lifecycle', () => {
  test('uses the deterministic provider, persists provenance, and keeps the tool result in the stream', async ({
    request,
  }) => {
    const prompt = `A durable lighthouse image ${uniq('prompt')}`;
    const turn = await runImageGenerationTurn(request, prompt);
    const imageId = await imageIdFromEvents(turn.events);

    expect(joinResponseText(turn.events)).toContain(
      'The deterministic image is ready.',
    );

    const row = await imageFromHistory(request, imageId);
    expect(row).toMatchObject({
      id: imageId,
      type: 'image',
      extension: 'png',
      mimeType: 'image/png',
      prompt,
      chatId: turn.chatId,
      workspaceId: null,
      imageUrl: `/api/uploads/images/${imageId}`,
    });

    const chatResponse = await request.get(`/api/chats/${turn.chatId}`);
    expect(chatResponse.status()).toBe(200);
    const chat = (await chatResponse.json()) as {
      messages: Array<{ role: string; messageId: string }>;
    };
    const assistant = chat.messages.find(
      (message) => message.role === 'assistant',
    );
    expect(assistant).toBeTruthy();
    expect(row.assistantMessageId).toBe(assistant!.messageId);
    expect(row.assistantMessageId).not.toBe(turn.messageId);

    const blob = await request.get(row.imageUrl);
    expect(blob.status()).toBe(200);
    expect(blob.headers()['content-type']).toBe('image/png');
    expect((await blob.body()).length).toBeGreaterThan(0);
  });

  test('keeps a private generated image in history while its chat exists', async ({
    request,
  }) => {
    const prompt = `Private image ${uniq('private-history')}`;
    const turn = await runImageGenerationTurn(request, prompt, {
      isPrivate: true,
    });
    const imageId = await imageIdFromEvents(turn.events);
    const row = await imageFromHistory(request, imageId);

    expect(row).toMatchObject({
      id: imageId,
      prompt,
      chatId: turn.chatId,
      workspaceId: null,
    });
    expect((await request.get(`/api/chats/${turn.chatId}`)).status()).toBe(200);

    // The normal private-session cleanup uses the same chat lifecycle seam;
    // explicit deletion keeps this shared API fixture isolated immediately.
    expect((await request.delete(`/api/chats/${turn.chatId}`)).status()).toBe(
      200,
    );
    expect((await request.get(row.imageUrl)).status()).toBe(404);
  });

  test('deleting a chat removes its chat-scoped image metadata and blob', async ({
    request,
  }) => {
    const turn = await runImageGenerationTurn(
      request,
      `Chat-scoped image ${uniq('delete-chat')}`,
    );
    const imageId = await imageIdFromEvents(turn.events);
    const row = await imageFromHistory(request, imageId);

    const deleted = await request.delete(`/api/chats/${turn.chatId}`);
    expect(deleted.status()).toBe(200);
    expect((await request.get(`/api/chats/${turn.chatId}`)).status()).toBe(404);
    expect((await request.get(row.imageUrl)).status()).toBe(404);

    const after = await request.get('/api/artifacts?type=images');
    const rows = (await after.json()) as Array<{ id: string }>;
    expect(rows.some((candidate) => candidate.id === imageId)).toBe(false);
  });

  test('retains a workspace image after chat deletion and removes it with the workspace', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: uniq('image-lifecycle-workspace'),
    });
    const turn = await runImageGenerationTurn(
      request,
      `Workspace image ${uniq('workspace-retain')}`,
      { workspaceId },
    );
    const imageId = await imageIdFromEvents(turn.events);
    const row = await imageFromHistory(request, imageId);
    expect(row.workspaceId).toBe(workspaceId);

    expect((await request.delete(`/api/chats/${turn.chatId}`)).status()).toBe(
      200,
    );
    const detached = await imageFromHistory(request, imageId);
    expect(detached).toMatchObject({
      id: imageId,
      chatId: null,
      workspaceId,
    });
    expect((await request.get(detached.imageUrl)).status()).toBe(200);

    expect(
      (await request.delete(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(204);
    expect((await request.get(detached.imageUrl)).status()).toBe(404);
    const after = await request.get('/api/artifacts?type=images');
    const rows = (await after.json()) as Array<{ id: string }>;
    expect(rows.some((candidate) => candidate.id === imageId)).toBe(false);
  });

  test('rewinding a chat removes discarded chat-scoped images', async ({
    request,
  }) => {
    const messageId = uid();
    const turn = await runImageGenerationTurn(
      request,
      `Rewind image ${uniq('rewind-chat')}`,
      { messageId },
    );
    const imageId = await imageIdFromEvents(turn.events);
    const row = await imageFromHistory(request, imageId);

    const resend = await request.post('/api/chat', {
      data: {
        message: {
          messageId,
          chatId: turn.chatId,
          content: 'Replace the discarded image turn.',
        },
        focusMode: 'chat',
        files: [],
        chatModel: { provider: 'test', name: 'test-direct' },
        systemModel: { provider: 'test', name: 'test-direct' },
        selectedSystemPromptIds: [],
      },
    });
    expect(resend.status()).toBe(200);
    await resend.body();

    expect((await request.get(row.imageUrl)).status()).toBe(404);
    const after = await request.get('/api/artifacts?type=images');
    const rows = (await after.json()) as Array<{ id: string }>;
    expect(rows.some((candidate) => candidate.id === imageId)).toBe(false);
  });

  test('rewinding preserves the workspace-owned image and blob', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: uniq('image-rewind-workspace'),
    });
    const messageId = uid();
    const turn = await runImageGenerationTurn(
      request,
      `Workspace rewind image ${uniq('rewind-workspace')}`,
      { messageId, workspaceId },
    );
    const imageId = await imageIdFromEvents(turn.events);
    const row = await imageFromHistory(request, imageId);

    const resend = await request.post('/api/chat', {
      data: {
        message: {
          messageId,
          chatId: turn.chatId,
          content: 'Replace the workspace image turn.',
        },
        focusMode: 'chat',
        files: [],
        chatModel: { provider: 'test', name: 'test-direct' },
        systemModel: { provider: 'test', name: 'test-direct' },
        selectedSystemPromptIds: [],
        workspaceId,
      },
    });
    expect(resend.status()).toBe(200);
    await resend.body();

    const surviving = await imageFromHistory(request, imageId);
    expect(surviving).toMatchObject({
      id: imageId,
      chatId: turn.chatId,
      workspaceId,
      assistantMessageId: row.assistantMessageId,
    });
    expect((await request.get(surviving.imageUrl)).status()).toBe(200);

    // Leave the workspace-owned fixture cleaned up for the shared API database.
    expect(
      (await request.delete(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(204);
  });
});
