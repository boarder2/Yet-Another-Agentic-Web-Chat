import type { APIRequestContext } from '@playwright/test';
import { uid, uniq } from './helpers';

async function postJson(
  request: APIRequestContext,
  url: string,
  body: Record<string, unknown>,
  okStatus = 200,
): Promise<unknown> {
  const res = await request.post(url, { data: body });
  if (res.status() !== okStatus) {
    const text = await res.text();
    throw new Error(
      `POST ${url} returned ${res.status()}: ${text.slice(0, 500)}`,
    );
  }
  return res.json();
}

export async function seedWorkspace(
  request: APIRequestContext,
  overrides?: Partial<{ name: string; description: string }>,
): Promise<string> {
  const body = await postJson(request, '/api/workspaces', {
    name: overrides?.name ?? uniq('ws'),
    ...(overrides?.description !== undefined
      ? { description: overrides.description }
      : {}),
  });
  return (body as { workspace: { id: string } }).workspace.id;
}

export async function seedChat(
  request: APIRequestContext,
  overrides?: Partial<{
    chatId: string;
    content: string;
    focusMode: string;
    workspaceId: string;
  }>,
): Promise<string> {
  const chatId = overrides?.chatId ?? uid();
  const messageId = uid();
  const res = await request.post('/api/chat', {
    data: {
      message: {
        messageId,
        chatId,
        content: overrides?.content ?? 'Hello',
      },
      focusMode: overrides?.focusMode ?? 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: 'test-direct' },
      systemModel: { provider: 'test', name: 'test-direct' },
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
  // Chat is created as a side-effect; the response is an SSE stream.
  // Consume it so the connection is released.
  await res.body();
  return chatId;
}

export async function seedMemory(
  request: APIRequestContext,
  overrides?: Partial<{ content: string; workspaceId: string }>,
): Promise<string> {
  const body = await postJson(
    request,
    '/api/memories',
    {
      content: overrides?.content ?? uniq('memory'),
      ...(overrides?.workspaceId ? { workspaceId: overrides.workspaceId } : {}),
    },
    201,
  );
  return (body as { id: string }).id;
}

export async function seedSkill(
  request: APIRequestContext,
  overrides?: Partial<{
    name: string;
    description: string;
    content: string;
  }>,
): Promise<string> {
  const name = overrides?.name ?? uniq('skill');
  const body = await postJson(
    request,
    '/api/skills',
    {
      name,
      description: overrides?.description ?? `Test skill ${name}`,
      content: overrides?.content ?? `# ${name}\n\nTest skill content.`,
    },
    201,
  );
  return (body as { id: string }).id;
}

export async function seedSystemPrompt(
  request: APIRequestContext,
  overrides?: Partial<{ name: string; content: string; type: string }>,
): Promise<string> {
  const name = overrides?.name ?? uniq('sp');
  const body = await postJson(
    request,
    '/api/system-prompts',
    {
      name,
      content: overrides?.content ?? `You are ${name}.`,
      type: overrides?.type ?? 'persona',
    },
    201,
  );
  return (body as { id: string }).id;
}

export async function seedScheduledTask(
  request: APIRequestContext,
  overrides?: Partial<{
    name: string;
    prompt: string;
    cronExpression: string;
  }>,
): Promise<string> {
  const body = await postJson(
    request,
    '/api/scheduled-tasks',
    {
      name: overrides?.name ?? uniq('task'),
      prompt: overrides?.prompt ?? 'Say hello',
      cronExpression: overrides?.cronExpression ?? '0 0 1 1 *',
      chatModel: { provider: 'test', name: 'test-direct' },
    },
    201,
  );
  return (body as { id: string }).id;
}

export async function seedWorkspaceFile(
  request: APIRequestContext,
  workspaceId: string,
  overrides?: Partial<{ name: string; content: string; mime: string }>,
): Promise<string> {
  const name = overrides?.name ?? `${uniq('file')}.txt`;
  const body = await postJson(request, `/api/workspaces/${workspaceId}/files`, {
    name,
    content: overrides?.content ?? 'test file content',
    mime: overrides?.mime ?? 'text/plain',
  });
  return (body as { file: { id: string } }).file.id;
}

/** Seed a scheduled task, run it, and return the resulting chat ID. */
export async function seedScheduledChat(
  request: APIRequestContext,
  overrides?: Partial<{
    taskName: string;
    prompt: string;
    focusMode: string;
  }>,
): Promise<string> {
  const taskId = await seedScheduledTask(request, {
    name: overrides?.taskName,
    prompt: overrides?.prompt,
  });
  const body = await postJson(
    request,
    `/api/scheduled-tasks/${taskId}/run`,
    {},
  );
  return (body as { chatId: string }).chatId;
}
