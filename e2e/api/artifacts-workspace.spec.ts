import { test, expect } from '../fixtures/api';
import { seedArtifact, runArtifactTurn, seedWorkspace } from '../utils/seed';
import { uid } from '../utils/helpers';
import { joinResponseText } from '../utils/sse';
import { buildArtifactMention } from '../../src/lib/artifacts/mention';

const DOC =
  '<!doctype html><html><head><title>Q3</title></head><body><h1>Q3 Report</h1><p>Revenue was flat.</p></body></html>';

test.describe('workspace-scoped artifacts', () => {
  test('an artifact created in a workspace chat belongs to the workspace', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { chatId, artifactId } = await seedArtifact(request, {
      workspaceId,
      title: 'Workspace Doc',
    });

    const byWorkspace = await request.get(
      `/api/artifacts?workspaceId=${workspaceId}`,
    );
    expect(byWorkspace.status()).toBe(200);
    expect(await byWorkspace.json()).toMatchObject([
      { id: artifactId, chatId, workspaceId, title: 'Workspace Doc' },
    ]);
  });

  test('an artifact created outside a workspace stays chat-scoped', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request);
    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();
    expect(detail).toMatchObject({ chatId, workspaceId: null });
  });

  test('a second chat in the same workspace can edit the artifact', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, {
      workspaceId,
      content: DOC,
    });

    // A brand-new chat that never saw the artifact being created.
    const { events } = await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Revenue grew 4%.`,
      { chatId: uid(), workspaceId, chatModel: 'test-artifact-edit' },
    );
    expect(events.find((e) => e.type === 'artifact_saved')?.data).toMatchObject(
      { version: 2, action: 'edit' },
    );

    const raw = await request.get(`/api/artifacts/${artifactId}/raw`);
    expect(await raw.text()).toContain('Revenue grew 4%.');
  });

  test('a chat in another workspace cannot reach the artifact', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const otherWorkspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, {
      workspaceId,
      content: DOC,
    });

    const { events } = await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Should not apply.`,
      {
        chatId: uid(),
        workspaceId: otherWorkspaceId,
        chatModel: 'test-artifact-edit',
      },
    );
    expect(events.filter((e) => e.type === 'artifact_saved')).toHaveLength(0);

    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();
    expect(detail.latestVersion).toBe(1);
  });

  test('an unscoped chat cannot reach a workspace artifact', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, {
      workspaceId,
      content: DOC,
    });

    const { events } = await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Should not apply.`,
      { chatId: uid(), chatModel: 'test-artifact-edit' },
    );
    expect(events.filter((e) => e.type === 'artifact_saved')).toHaveLength(0);
  });
});

test.describe('mentions put a artifact on a fresh chat’s roster', () => {
  const echoPrompt = async (
    request: Parameters<typeof runArtifactTurn>[0],
    prompt: string,
    overrides: Parameters<typeof runArtifactTurn>[2],
  ) => {
    const { events } = await runArtifactTurn(request, prompt, {
      ...overrides,
      chatModel: 'test-prompt-echo',
    });
    return joinResponseText(events);
  };

  test('a mentioned artifact appears in a chat that never created it', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, {
      workspaceId,
      title: 'Mentioned Doc',
    });

    const prompt = await echoPrompt(
      request,
      `Update ${buildArtifactMention(artifactId, 'Mentioned Doc')} please`,
      { chatId: uid(), workspaceId },
    );
    expect(prompt).toContain('## Artifacts available in this chat');
    expect(prompt).toContain(artifactId);
    expect(prompt).toContain('"Mentioned Doc"');
    expect(prompt).toContain('(workspace artifact)');
  });

  test('an unmentioned workspace artifact stays off the roster', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, {
      workspaceId,
      title: 'Unmentioned Doc',
    });

    const prompt = await echoPrompt(request, 'hello', {
      chatId: uid(),
      workspaceId,
    });
    expect(prompt).not.toContain(artifactId);
  });

  test('mentioning a artifact from another workspace resolves to nothing', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const otherWorkspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, {
      workspaceId,
      title: 'Foreign Doc',
    });

    const prompt = await echoPrompt(
      request,
      `Update ${buildArtifactMention(artifactId, 'Foreign Doc')} please`,
      { chatId: uid(), workspaceId: otherWorkspaceId },
    );
    expect(prompt).not.toContain(artifactId);
    expect(prompt).not.toContain('## Artifacts available in this chat');
  });
});

test.describe('workspace artifact lifecycle', () => {
  test('deleting the creating chat leaves the artifact, detached', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { chatId, artifactId } = await seedArtifact(request, {
      workspaceId,
      content: DOC,
    });

    expect((await request.delete(`/api/chats/${chatId}`)).ok()).toBe(true);

    const detail = await request.get(`/api/artifacts/${artifactId}`);
    expect(detail.status()).toBe(200);
    // Provenance is dropped, the artifact and its history are not.
    expect(await detail.json()).toMatchObject({
      chatId: null,
      workspaceId,
      latestVersion: 1,
    });
  });

  test('deleting the creating chat still removes a chat-scoped artifact', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request);
    expect((await request.delete(`/api/chats/${chatId}`)).ok()).toBe(true);
    expect((await request.get(`/api/artifacts/${artifactId}`)).status()).toBe(
      404,
    );
  });

  test('deleting the workspace takes its artifacts with it', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, { workspaceId });

    expect((await request.delete(`/api/workspaces/${workspaceId}`)).ok()).toBe(
      true,
    );
    expect((await request.get(`/api/artifacts/${artifactId}`)).status()).toBe(
      404,
    );
  });

  test('rewinding a turn does not roll back a workspace artifact', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { chatId, artifactId } = await seedArtifact(request, {
      workspaceId,
      content: DOC,
    });
    const edit = await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Revenue grew 4%.`,
      { chatId, workspaceId, chatModel: 'test-artifact-edit' },
    );

    // Re-sending the edit turn's user message rewinds the chat from there. For
    // a chat-scoped artifact that drops the version the turn produced; a
    // workspace artifact is shared, so its history must survive — another chat
    // may already have built on it.
    const resend = await request.post('/api/chat', {
      data: {
        message: {
          messageId: edit.messageId,
          chatId,
          content: 'rewound prompt',
        },
        focusMode: 'webSearch',
        files: [],
        chatModel: { provider: 'test', name: 'test-direct' },
        systemModel: { provider: 'test', name: 'test-direct' },
        selectedSystemPromptIds: [],
        workspaceId,
      },
    });
    await resend.body();

    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();
    expect(detail.latestVersion).toBe(2);
    expect(detail.versions).toHaveLength(2);
  });

  test('a workspace artifact can be deleted on its own', async ({
    request,
  }) => {
    const workspaceId = await seedWorkspace(request);
    const { artifactId } = await seedArtifact(request, { workspaceId });

    const del = await request.delete(`/api/artifacts/${artifactId}`);
    expect(del.status()).toBe(200);
    expect((await request.get(`/api/artifacts/${artifactId}`)).status()).toBe(
      404,
    );
  });

  test('a chat-scoped artifact has no standalone delete', async ({
    request,
  }) => {
    const { artifactId } = await seedArtifact(request);
    expect(
      (await request.delete(`/api/artifacts/${artifactId}`)).status(),
    ).toBe(400);
    expect((await request.get(`/api/artifacts/${artifactId}`)).status()).toBe(
      200,
    );
  });
});
