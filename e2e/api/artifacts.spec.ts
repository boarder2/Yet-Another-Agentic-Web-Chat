import { test, expect } from '../fixtures/api';
import { seedArtifact, runArtifactTurn, seedChat } from '../utils/seed';
import { uid } from '../utils/helpers';
import { joinResponseText } from '../utils/sse';

const DOC =
  '<!doctype html><html><head><title>Q3</title></head><body><h1>Q3 Report</h1><p>Revenue was flat.</p></body></html>';

test.describe('artifact creation via the agent', () => {
  test('create_artifact persists an artifact and emits artifact_saved', async ({
    request,
  }) => {
    const { chatId, events } = await runArtifactTurn(
      request,
      `Quarterly Report|${DOC}`,
    );

    const saved = events.filter((e) => e.type === 'artifact_saved');
    expect(saved).toHaveLength(1);
    expect(saved[0].data).toMatchObject({
      title: 'Quarterly Report',
      version: 1,
      action: 'create',
    });

    const list = await request.get(`/api/artifacts?chatId=${chatId}`);
    expect(list.status()).toBe(200);
    const artifacts = await list.json();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      chatId,
      title: 'Quarterly Report',
      latestVersion: 1,
      versionCount: 1,
    });
  });

  test('the assistant message carries an artifact widget envelope', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      title: 'Widget Report',
    });

    const res = await request.get(`/api/chats/${chatId}`);
    const { messages } = await res.json();
    const assistant = messages.find(
      (m: { role: string }) => m.role === 'assistant',
    );
    expect(assistant.content).toContain('```yaawc:artifact');
    expect(assistant.content).toContain(`"id":"${artifactId}"`);
    expect(assistant.content).toContain('"title":"Widget Report"');
  });

  test('edit_artifact accretes a version and leaves the original intact', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });

    const { events } = await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Revenue grew 4%.`,
      { chatId, chatModel: 'test-artifact-edit' },
    );
    const saved = events.find((e) => e.type === 'artifact_saved');
    expect(saved?.data).toMatchObject({ version: 2, action: 'edit' });

    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();
    expect(detail.latestVersion).toBe(2);
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([
      1, 2,
    ]);

    const v1 = await request.get(`/api/artifacts/${artifactId}/raw?version=1`);
    expect(await v1.text()).toContain('Revenue was flat.');
    const v2 = await request.get(`/api/artifacts/${artifactId}/raw?version=2`);
    const v2Text = await v2.text();
    expect(v2Text).toContain('Revenue grew 4%.');
    expect(v2Text).not.toContain('Revenue was flat.');
  });

  test('repeated writes in one turn collapse to a single card', async ({
    request,
  }) => {
    const { chatId } = await runArtifactTurn(
      request,
      `Multi Report|Seed|Edited`,
      { chatModel: 'test-artifact-multi' },
    );

    const artifacts = await (
      await request.get(`/api/artifacts?chatId=${chatId}`)
    ).json();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].latestVersion).toBe(2);

    const { messages } = await (
      await request.get(`/api/chats/${chatId}`)
    ).json();
    const assistant = messages.find(
      (m: { role: string }) => m.role === 'assistant',
    );
    expect(assistant.content.match(/yaawc:artifact/g)).toHaveLength(1);
    expect(assistant.content).toContain('"version":2');
  });

  test('read_artifact returns the current content to the agent', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });
    const { events } = await runArtifactTurn(request, artifactId, {
      chatId,
      chatModel: 'test-artifact-read',
    });
    // Reading is not a write: no new version, no card.
    expect(events.filter((e) => e.type === 'artifact_saved')).toHaveLength(0);
    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();
    expect(detail.latestVersion).toBe(1);
  });

  test('read_artifact resolves an explicit earlier version', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });
    await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Revenue doubled.`,
      {
        chatId,
        chatModel: 'test-artifact-edit',
      },
    );

    const { events } = await runArtifactTurn(request, `${artifactId}|1`, {
      chatId,
      chatModel: 'test-artifact-read',
    });
    const echoed = JSON.parse(joinResponseText(events));
    expect(echoed.version).toBe(1);
    expect(echoed.content).toContain('Revenue was flat.');
    expect(echoed.content).not.toContain('Revenue doubled.');
  });

  test('read_artifact defaults to the current version', async ({ request }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });
    await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Revenue doubled.`,
      {
        chatId,
        chatModel: 'test-artifact-edit',
      },
    );

    const { events } = await runArtifactTurn(request, artifactId, {
      chatId,
      chatModel: 'test-artifact-read',
    });
    const echoed = JSON.parse(joinResponseText(events));
    expect(echoed.version).toBe(2);
    expect(echoed.content).toContain('Revenue doubled.');
  });

  test('read_artifact reports the valid range for an out-of-range version', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });
    const { events } = await runArtifactTurn(request, `${artifactId}|99`, {
      chatId,
      chatModel: 'test-artifact-read',
    });
    // The artifact exists, so the error must say so — not claim it is missing.
    const echoed = joinResponseText(events);
    expect(echoed).toContain('has versions 1-1');
    expect(echoed).not.toContain('no artifact with id');
  });

  test('artifact tools are withheld from private chats', async ({
    request,
  }) => {
    const { chatId } = await runArtifactTurn(request, `Secret|${DOC}`, {
      isPrivate: true,
    });
    const artifacts = await (
      await request.get(`/api/artifacts?chatId=${chatId}`)
    ).json();
    expect(artifacts).toEqual([]);
  });
});

test.describe('artifact roster injected into the agent prompt', () => {
  const echoPrompt = async (
    request: Parameters<typeof runArtifactTurn>[0],
    overrides: Parameters<typeof runArtifactTurn>[2],
  ) => {
    const { events } = await runArtifactTurn(request, 'what do you have?', {
      ...overrides,
      chatModel: 'test-prompt-echo',
    });
    return joinResponseText(events);
  };

  test("lists the chat's artifacts so later turns can address them", async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      title: 'Roster Report',
    });
    const prompt = await echoPrompt(request, { chatId });

    expect(prompt).toContain('## Artifacts available in this chat');
    expect(prompt).toContain(artifactId);
    expect(prompt).toContain('"Roster Report"');
    expect(prompt).toContain('v1, updated');
    expect(prompt).toContain('do not call `create_artifact`');
  });

  test('is absent from a chat with no artifacts', async ({ request }) => {
    const prompt = await echoPrompt(request, { chatId: uid() });
    expect(prompt).not.toContain('## Artifacts available in this chat');
    // The guidance still ships; only the roster is conditional.
    expect(prompt).toContain('## Artifacts');
  });

  test('is withheld in chat mode, which has no artifact tools', async ({
    request,
  }) => {
    const { chatId } = await seedArtifact(request, { title: 'Hidden Report' });
    const prompt = await echoPrompt(request, { chatId, focusMode: 'chat' });
    expect(prompt).not.toContain('## Artifacts available in this chat');
    expect(prompt).not.toContain('Hidden Report');
  });

  test('is withheld in private chats, where the tools are gated out', async ({
    request,
  }) => {
    const { chatId } = await seedArtifact(request, { title: 'Private Report' });
    const prompt = await echoPrompt(request, { chatId, isPrivate: true });
    expect(prompt).not.toContain('## Artifacts available in this chat');
    expect(prompt).not.toContain('Private Report');
  });
});

test.describe('list and detail routes', () => {
  test('no chatId/workspaceId selects list-all mode instead of a 400', async ({
    request,
  }) => {
    const res = await request.get('/api/artifacts');
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    // The list-all projection joins the owning chat's title.
    for (const row of list) expect(row).toHaveProperty('chatTitle');
  });

  test('list is scoped to its chat and carries no content', async ({
    request,
  }) => {
    const a = await seedArtifact(request, { title: 'Chat A Doc' });
    const b = await seedArtifact(request, { title: 'Chat B Doc' });

    const listA = await (
      await request.get(`/api/artifacts?chatId=${a.chatId}`)
    ).json();
    expect(listA).toHaveLength(1);
    expect(listA[0].title).toBe('Chat A Doc');
    expect(listA[0]).not.toHaveProperty('content');
    expect(listA.map((x: { id: string }) => x.id)).not.toContain(b.artifactId);
  });

  test('detail lists version metadata without content', async ({ request }) => {
    const { artifactId } = await seedArtifact(request, { content: DOC });
    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();

    expect(detail).toMatchObject({ id: artifactId, latestVersion: 1 });
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0].bytes).toBe(DOC.length);
    expect(detail.versions[0]).not.toHaveProperty('content');
  });

  test('a version is anchored to the assistant message that wrote it', async ({
    request,
  }) => {
    const { messageId: userMessageId, events } = await runArtifactTurn(
      request,
      `Anchored|${DOC}`,
    );
    const saved = events.find((e) => e.type === 'artifact_saved')!;
    const { artifactId } = saved.data as { artifactId: string };
    const assistantMessageId = saved.messageId;
    expect(assistantMessageId).not.toBe(userMessageId);

    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();
    expect(detail.versions[0].messageId).toBe(assistantMessageId);
  });

  test('detail 404s for an unknown id', async ({ request }) => {
    const res = await request.get(`/api/artifacts/${uid()}`);
    expect(res.status()).toBe(404);
  });
});

test.describe('raw route', () => {
  test('serves the exact stored bytes as html under the sandbox CSP', async ({
    request,
  }) => {
    const { artifactId } = await seedArtifact(request, { content: DOC });
    const res = await request.get(`/api/artifacts/${artifactId}/raw`);

    expect(res.status()).toBe(200);
    expect(await res.text()).toBe(DOC);

    const headers = res.headers();
    expect(headers['content-type']).toContain('text/html');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toContain('no-store');

    const csp = headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    // The response, not the embedder, is what strands the artifact on an
    // opaque origin — this route is reachable top-level, where no iframe
    // sandbox attribute applies.
    expect(csp).toContain('sandbox allow-scripts allow-popups');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain('img-src data: blob:');
    expect(csp).toContain('font-src data:');
    expect(csp).toContain('media-src data: blob:');
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    // The whole point: an artifact can never reach the network.
    expect(csp).not.toContain('connect-src');
    expect(csp).not.toMatch(/https?:/);
  });

  test('rejects a malformed version and 404s a missing one', async ({
    request,
  }) => {
    const { artifactId } = await seedArtifact(request);
    expect(
      (
        await request.get(`/api/artifacts/${artifactId}/raw?version=abc`)
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.get(`/api/artifacts/${artifactId}/raw?version=99`)
      ).status(),
    ).toBe(404);
    expect((await request.get(`/api/artifacts/${uid()}/raw`)).status()).toBe(
      404,
    );
  });

  test('download attaches the file and inlines the CSP as a meta tag', async ({
    request,
  }) => {
    const { artifactId } = await seedArtifact(request, {
      title: 'Q3 Revenue Report!',
      content: DOC,
    });
    const res = await request.get(
      `/api/artifacts/${artifactId}/raw?download=1`,
    );

    expect(res.headers()['content-disposition']).toBe(
      'attachment; filename="q3-revenue-report-v1.html"',
    );
    const body = await res.text();
    expect(body).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(body).toContain("default-src 'none'");
    // Meaningless in a downloaded file, and dropped from the meta variant.
    const meta = /content="([^"]*)"/.exec(body)?.[1] ?? '';
    expect(meta).not.toContain('frame-ancestors');
    // The artifact itself is untouched apart from the injected tag.
    expect(body).toContain('<h1>Q3 Report</h1>');
  });

  test('a permissive policy the agent wrote cannot suppress the exported one', async ({
    request,
  }) => {
    // The agent authors these bytes, so an artifact carrying its own
    // `default-src *` must still export with our policy ahead of it.
    const { artifactId } = await seedArtifact(request, {
      content:
        '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>X</title></head><body>x</body></html>',
    });
    const body = await (
      await request.get(`/api/artifacts/${artifactId}/raw?download=1`)
    ).text();

    expect(body).toContain("default-src 'none'");
    expect(body.indexOf("default-src 'none'")).toBeLessThan(
      body.indexOf('default-src *'),
    );
  });
});

test.describe('deletion and cascades', () => {
  test('a chat-scoped artifact cannot be deleted on its own', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request);

    // A chat-scoped artifact is part of its transcript and dies with the chat.
    // DELETE exists for workspace artifacts, so the refusal is a rejected
    // request rather than a missing method.
    expect(
      (await request.delete(`/api/artifacts/${artifactId}`)).status(),
    ).toBe(400);

    expect((await request.get(`/api/artifacts/${artifactId}`)).status()).toBe(
      200,
    );
    expect(
      await (await request.get(`/api/artifacts?chatId=${chatId}`)).json(),
    ).toHaveLength(1);
  });

  test('deleting the chat drops its artifacts', async ({ request }) => {
    const { chatId, artifactId } = await seedArtifact(request);
    expect((await request.delete(`/api/chats/${chatId}`)).status()).toBe(200);
    expect((await request.get(`/api/artifacts/${artifactId}`)).status()).toBe(
      404,
    );
  });

  test('rewinding the producing message rolls the artifact back a version', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });
    const edit = await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Revenue grew 4%.`,
      { chatId, chatModel: 'test-artifact-edit' },
    );
    expect(
      (await (await request.get(`/api/artifacts/${artifactId}`)).json())
        .latestVersion,
    ).toBe(2);

    // Re-sending the edit turn's user message nukes and rebuilds from there,
    // so the version that turn produced must go with it.
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
      },
    });
    await resend.body();

    const detail = await (
      await request.get(`/api/artifacts/${artifactId}`)
    ).json();
    expect(detail.latestVersion).toBe(1);
    expect(detail.versions).toHaveLength(1);
    expect(
      await (await request.get(`/api/artifacts/${artifactId}/raw`)).text(),
    ).toContain('Revenue was flat.');
  });

  test('rewinding the creating message removes the artifact entirely', async ({
    request,
  }) => {
    const chatId = uid();
    const { artifactId, messageId } = await seedArtifact(request, { chatId });

    const resend = await request.post('/api/chat', {
      data: {
        message: { messageId, chatId, content: 'a different question' },
        focusMode: 'webSearch',
        files: [],
        chatModel: { provider: 'test', name: 'test-direct' },
        systemModel: { provider: 'test', name: 'test-direct' },
        selectedSystemPromptIds: [],
      },
    });
    await resend.body();

    expect((await request.get(`/api/artifacts/${artifactId}`)).status()).toBe(
      404,
    );
    expect(
      await (await request.get(`/api/artifacts?chatId=${chatId}`)).json(),
    ).toEqual([]);
  });

  test('an unrelated chat keeps its artifacts', async ({ request }) => {
    const keep = await seedArtifact(request);
    const drop = await seedArtifact(request);
    await request.delete(`/api/chats/${drop.chatId}`);
    expect(
      (await request.get(`/api/artifacts/${keep.artifactId}`)).status(),
    ).toBe(200);
  });
});

test.describe('edit failure contracts', () => {
  test('a non-matching oldStr fails without writing a version', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: DOC,
    });
    const { events } = await runArtifactTurn(
      request,
      `${artifactId}|text that is absent|replacement`,
      { chatId, chatModel: 'test-artifact-edit' },
    );
    expect(events.filter((e) => e.type === 'artifact_saved')).toHaveLength(0);
    expect(
      (await (await request.get(`/api/artifacts/${artifactId}`)).json())
        .latestVersion,
    ).toBe(1);
  });

  test('an ambiguous oldStr fails without writing a version', async ({
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      content: '<ul><li>Item</li><li>Item</li></ul>',
    });
    const { events } = await runArtifactTurn(
      request,
      `${artifactId}|<li>Item</li>|<li>Thing</li>`,
      { chatId, chatModel: 'test-artifact-edit' },
    );
    expect(events.filter((e) => e.type === 'artifact_saved')).toHaveLength(0);
    expect(
      (await (await request.get(`/api/artifacts/${artifactId}`)).json())
        .latestVersion,
    ).toBe(1);
  });

  test('an artifact from another chat is not editable', async ({ request }) => {
    const { artifactId } = await seedArtifact(request, { content: DOC });
    const otherChat = await seedChat(request, { content: 'unrelated' });

    const { events } = await runArtifactTurn(
      request,
      `${artifactId}|Revenue was flat.|Leaked.`,
      { chatId: otherChat, chatModel: 'test-artifact-edit' },
    );
    expect(events.filter((e) => e.type === 'artifact_saved')).toHaveLength(0);
    expect(
      await (await request.get(`/api/artifacts/${artifactId}/raw`)).text(),
    ).toContain('Revenue was flat.');
  });
});
