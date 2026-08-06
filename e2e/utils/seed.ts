import { expect, type APIRequestContext } from '@playwright/test';
import type { WorkspaceModelOverride } from '../../src/lib/workspaces/types';
import { uid, uniq, baseURL } from './helpers';
import { streamChatUntil, collectSseEvents, type ChatEvent } from './sse';

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
  overrides?: Partial<{
    name: string;
    description: string;
    modelOverride: WorkspaceModelOverride | null;
    autoAcceptFileEdits: 0 | 1;
    instructions: string;
  }>,
): Promise<string> {
  const body = await postJson(request, '/api/workspaces', {
    name: overrides?.name ?? uniq('ws'),
    ...(overrides?.description !== undefined
      ? { description: overrides.description }
      : {}),
    ...(overrides?.instructions !== undefined
      ? { instructions: overrides.instructions }
      : {}),
    ...(overrides?.modelOverride !== undefined
      ? { modelOverride: overrides.modelOverride }
      : {}),
    ...(overrides?.autoAcceptFileEdits !== undefined
      ? { autoAcceptFileEdits: overrides.autoAcceptFileEdits }
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
    /** Test model name, e.g. `test-long` for an answer taller than a viewport. */
    chatModel: string;
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
      chatModel: {
        provider: 'test',
        name: overrides?.chatModel ?? 'test-direct',
      },
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

/**
 * Seed a workspace + file, then run a `test-tool` chat (`localResearch`) that
 * triggers a real `file_search` tool call against that file. Produces a chat
 * whose assistant message carries a `yaawc:tool_call` widget envelope and
 * whose file_search results land only in a `system`-role persisted-tool-context
 * row — deterministic execution-only content for sanitization/history-search specs.
 */
export async function seedToolChat(
  request: APIRequestContext,
  overrides?: Partial<{
    chatId: string;
    promptContent: string;
    fileContent: string;
    workspaceId: string;
    /** Test model name, e.g. `test-tool-long` for a tool call + a tall answer. */
    chatModel: string;
  }>,
): Promise<{ chatId: string; workspaceId: string }> {
  const workspaceId =
    overrides?.workspaceId ??
    (await seedWorkspace(request, { name: uniq('tool-chat-ws') }));
  await seedWorkspaceFile(request, workspaceId, {
    name: `${uniq('doc')}.txt`,
    content: overrides?.fileContent ?? 'default deterministic document content',
  });

  const chatId = overrides?.chatId ?? uid();
  const messageId = uid();
  const res = await request.post('/api/chat', {
    data: {
      message: {
        messageId,
        chatId,
        content: overrides?.promptContent ?? 'Tell me about the document',
      },
      focusMode: 'localResearch',
      files: [],
      chatModel: {
        provider: 'test',
        name: overrides?.chatModel ?? 'test-tool',
      },
      systemModel: { provider: 'test', name: 'test-tool' },
      selectedSystemPromptIds: [],
      workspaceId,
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
  return { chatId, workspaceId };
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
    workspaceId: string | null;
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
      workspaceId: overrides?.workspaceId ?? null,
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

export async function seedWorkflow(
  request: APIRequestContext,
  overrides?: Partial<{
    name: string;
    prompt: string;
    description: string;
    icon: string;
    focusMode: string;
  }>,
): Promise<string> {
  const body = await postJson(
    request,
    '/api/workflows',
    {
      name: overrides?.name ?? uniq('workflow'),
      prompt: overrides?.prompt ?? 'Say hello',
      ...(overrides?.description !== undefined
        ? { description: overrides.description }
        : {}),
      ...(overrides?.icon !== undefined ? { icon: overrides.icon } : {}),
      ...(overrides?.focusMode !== undefined
        ? { focusMode: overrides.focusMode }
        : {}),
      chatModel: { provider: 'test', name: 'test-direct' },
    },
    201,
  );
  return (body as { id: string }).id;
}

export async function seedSchedule(
  request: APIRequestContext,
  workflowId: string,
  overrides?: Partial<{
    label: string;
    cronExpression: string;
    inputValues: Record<string, string | string[]>;
  }>,
): Promise<string> {
  const body = await postJson(
    request,
    `/api/workflows/${workflowId}/schedules`,
    {
      label: overrides?.label ?? uniq('schedule'),
      cronExpression: overrides?.cronExpression ?? '0 0 1 1 *',
      inputValues: overrides?.inputValues ?? {},
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

/** Current version stamp of a workspace file — the CAS token every write needs. */
export async function fileSha(
  request: APIRequestContext,
  workspaceId: string,
  fileId: string,
): Promise<string> {
  const res = await request.get(
    `/api/workspaces/${workspaceId}/files/${fileId}`,
  );
  const body = (await res.json()) as { file: { sha256: string } };
  return body.file.sha256;
}

export interface AwaitingApproval {
  chatId: string;
  messageId: string;
  approvalId: string;
  question: string;
  events: ChatEvent[];
}

/**
 * Start a chat run with the `test-ask-user` model and stop reading its SSE
 * stream as soon as it pauses at the ask_user interrupt (awaiting_user).
 * Uses a raw fetch under the hood (see streamChatUntil) since the run's
 * connection stays open indefinitely once paused — the `request` fixture
 * would hang waiting for the body to close.
 */
export async function seedAwaitingApproval(
  overrides?: Partial<{
    chatId: string;
    messageId: string;
    content: string;
    focusMode: string;
  }>,
): Promise<AwaitingApproval> {
  const chatId = overrides?.chatId ?? uid();
  const messageId = overrides?.messageId ?? uid();
  const events = await streamChatUntil(
    baseURL(),
    {
      message: {
        messageId,
        chatId,
        content: overrides?.content ?? 'ask-user test',
      },
      focusMode: overrides?.focusMode ?? 'chat',
      files: [],
      chatModel: { provider: 'test', name: 'test-ask-user' },
      systemModel: { provider: 'test', name: 'test-ask-user' },
      selectedSystemPromptIds: [],
      workspaceId: null,
    },
    (evts) => evts.some((e) => e.type === 'ask_user_pending'),
  );
  const pending = events.find((e) => e.type === 'ask_user_pending');
  if (!pending) {
    throw new Error('ask_user_pending event never arrived');
  }
  const data = pending.data as Record<string, unknown>;
  return {
    chatId,
    messageId,
    approvalId: data.approvalId as string,
    question: data.question as string,
    events,
  };
}

/**
 * Start a workspace-edit run with the `test-workspace-edit` model and stop
 * reading its SSE stream once it pauses at the edit-approval interrupt. Leaves
 * the run parked there, so a spec can set up UI state and only then resolve the
 * approval via `runs/resume` — no wall-clock racing against the agent.
 */
export async function seedAwaitingWorkspaceEdit(
  workspaceId: string,
  edit: { file: string; oldString: string; newString: string },
): Promise<AwaitingApproval> {
  const chatId = uid();
  const messageId = uid();
  const events = await streamChatUntil(
    baseURL(),
    {
      message: {
        messageId,
        chatId,
        // The test model reads its tool-call args straight out of the prompt.
        content: `${edit.file}|${edit.oldString}|${edit.newString}`,
      },
      focusMode: 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: 'test-workspace-edit' },
      systemModel: { provider: 'test', name: 'test-workspace-edit' },
      selectedSystemPromptIds: [],
      workspaceId,
    },
    (evts) => evts.some((e) => e.type === 'workspace_edit_pending'),
  );
  const pending = events.find((e) => e.type === 'workspace_edit_pending');
  if (!pending) {
    throw new Error('workspace_edit_pending event never arrived');
  }
  const data = pending.data as Record<string, unknown>;
  return {
    chatId,
    messageId,
    approvalId: data.approvalId as string,
    question: '',
    events,
  };
}

/**
 * Start a skill-edit run with the `test-skill-edit` model and park it at the
 * approval interrupt, so a spec can inspect what the approval panel offers
 * before deciding. Omitted fields are left out of the tool call, which is how
 * a spec scripts a scope-only move (or a proposal that changes nothing).
 */
export async function seedAwaitingSkillEdit(
  edit: {
    name: string;
    scope?: 'global' | 'workspace';
    newScope?: 'global' | 'workspace';
    content?: string;
    disableModelInvocation?: boolean;
  },
  workspaceId?: string,
): Promise<AwaitingApproval> {
  const chatId = uid();
  const messageId = uid();
  const events = await streamChatUntil(
    baseURL(),
    {
      message: {
        messageId,
        chatId,
        // The test model reads its tool-call args straight out of the prompt.
        content: [
          edit.name,
          edit.scope ?? '',
          edit.newScope ?? '',
          edit.content ?? '',
          edit.disableModelInvocation === undefined
            ? ''
            : String(edit.disableModelInvocation),
        ].join('|'),
      },
      focusMode: 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: 'test-skill-edit' },
      systemModel: { provider: 'test', name: 'test-skill-edit' },
      selectedSystemPromptIds: [],
      ...(workspaceId && { workspaceId }),
    },
    (evts) => evts.some((e) => e.type === 'skill_edit_pending'),
  );
  const pending = events.find((e) => e.type === 'skill_edit_pending');
  if (!pending) {
    throw new Error('skill_edit_pending event never arrived');
  }
  const data = pending.data as Record<string, unknown>;
  return {
    chatId,
    messageId,
    approvalId: data.approvalId as string,
    question: '',
    events,
  };
}

/**
 * Cancel a run and poll until its terminal state is persisted. Tests that
 * seed an awaiting-approval run but resolve it some other way (e.g. via
 * `runs/resume`) don't need this; tests that only inspect the paused state
 * must call this before finishing so no unresolved approval or active run
 * leaks into other specs (`api/approvals.spec.ts`'s empty-array checks in
 * particular assert against ALL pending approvals, unscoped).
 */
export async function cancelAwaitingRun(
  request: APIRequestContext,
  params: { messageId: string; chatId: string },
): Promise<void> {
  await request.post('/api/chat/cancel', {
    data: { messageId: params.messageId },
  });
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/chats/${params.chatId}`);
        const body = (await res.json()) as {
          chat: { lastRunStatus: string | null };
        };
        return body.chat.lastRunStatus;
      },
      { timeout: 5000 },
    )
    .toBe('cancelled');
}

/**
 * Seed a workflow + one schedule, fire the schedule immediately, and return the
 * resulting scheduled-run chat ID (carries `scheduleId`).
 */
export async function seedScheduledChat(
  request: APIRequestContext,
  overrides?: Partial<{
    taskName: string;
    prompt: string;
    focusMode: string;
  }>,
): Promise<string> {
  const workflowId = await seedWorkflow(request, {
    name: overrides?.taskName,
    prompt: overrides?.prompt,
    focusMode: overrides?.focusMode,
  });
  const scheduleId = await seedSchedule(request, workflowId, {
    label: overrides?.taskName,
  });
  const body = await postJson(request, `/api/schedules/${scheduleId}/run`, {});
  return (body as { chatId: string }).chatId;
}

export interface SeededArtifact {
  chatId: string;
  artifactId: string;
  messageId: string;
}

/**
 * Run one artifact-tool turn against the mocked provider. The scripted models
 * read their arguments from the prompt: `test-artifact` takes `title|content`,
 * `test-artifact-edit` takes `artifactId|oldStr|newStr`, `test-artifact-read`
 * takes `artifactId`, and `test-artifact-multi` takes `title|oldStr|newStr`
 * (creating, then editing what it just created).
 */
export async function runArtifactTurn(
  request: APIRequestContext,
  prompt: string,
  overrides?: Partial<{
    chatId: string;
    chatModel: string;
    isPrivate: boolean;
    focusMode: string;
    workspaceId: string;
  }>,
): Promise<{ chatId: string; messageId: string; events: ChatEvent[] }> {
  const chatId = overrides?.chatId ?? uid();
  const messageId = uid();
  const res = await request.post('/api/chat', {
    data: {
      message: { messageId, chatId, content: prompt },
      focusMode: overrides?.focusMode ?? 'webSearch',
      files: [],
      chatModel: {
        provider: 'test',
        name: overrides?.chatModel ?? 'test-artifact',
      },
      systemModel: { provider: 'test', name: 'test-direct' },
      selectedSystemPromptIds: [],
      ...(overrides?.isPrivate ? { isPrivate: true } : {}),
      ...(overrides?.workspaceId ? { workspaceId: overrides.workspaceId } : {}),
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

/** Create one artifact via the agent and return its ids. */
export async function seedArtifact(
  request: APIRequestContext,
  overrides?: Partial<{
    chatId: string;
    title: string;
    content: string;
    workspaceId: string;
  }>,
): Promise<SeededArtifact> {
  const title = overrides?.title ?? uniq('Report');
  const content =
    overrides?.content ??
    '<!doctype html><html><head><title>T</title></head><body><h1>Seed</h1></body></html>';
  const { chatId, messageId, events } = await runArtifactTurn(
    request,
    `${title}|${content}`,
    { chatId: overrides?.chatId, workspaceId: overrides?.workspaceId },
  );
  const saved = events.find((e) => e.type === 'artifact_saved');
  if (!saved) {
    throw new Error('No artifact_saved event was emitted for the seeded turn');
  }
  const { artifactId } = saved.data as { artifactId: string };
  return { chatId, artifactId, messageId };
}
