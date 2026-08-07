import { test, expect } from '../fixtures/api';
import { seedArtifact, seedWorkspace, runArtifactTurn } from '../utils/seed';
import { uniq } from '../utils/helpers';

test.describe('artifact list-all (history tab) endpoint', () => {
  test('no filter returns every artifact across scopes, joined to chat titles', async ({
    request,
  }) => {
    const ws = await seedWorkspace(request, { name: uniq('hist-ws') });

    // A chat-scoped artifact (chat has no workspace).
    const scoped = await seedArtifact(request, { title: uniq('Scoped') });
    // A workspace-owned document (chat inside the workspace).
    const owned = await seedArtifact(request, {
      title: uniq('Owned'),
      workspaceId: ws,
    });

    const res = await request.get('/api/artifacts');
    expect(res.status()).toBe(200);
    const list = await res.json();

    const ids = list.map((r: { id: string }) => r.id);
    expect(ids).toContain(scoped.artifactId);
    expect(ids).toContain(owned.artifactId);

    // Every surviving owning chat supplies its title as provenance.
    for (const id of [scoped.artifactId, owned.artifactId]) {
      const row = list.find((r: { id: string }) => r.id === id);
      expect(row.chatId).toBeTruthy();
      expect(typeof row.chatTitle).toBe('string');
      expect(row.chatTitle.length).toBeGreaterThan(0);
    }
    // Each row carries the summary projection, never the content.
    for (const row of list) {
      expect(row).toHaveProperty('latestVersion');
      expect(row).toHaveProperty('versionCount');
      expect(row).not.toHaveProperty('content');
    }
  });

  test('is ordered most-recently-updated first', async ({ request }) => {
    const a = await seedArtifact(request, { title: uniq('First') });
    const b = await seedArtifact(request, { title: uniq('Second') });
    const c = await seedArtifact(request, { title: uniq('Third') });

    // updated_at is second-precision and SQLite ties on it, so back-to-back
    // creations collide. Wait a beat so the bump lands in a strictly later
    // second and `a` becomes unambiguously newest.
    await new Promise((r) => setTimeout(r, 1100));
    await runArtifactTurn(
      request,
      `${a.artifactId}|<h1>Seed</h1>|<h1>Bumped</h1>`,
      {
        chatId: a.chatId,
        chatModel: 'test-artifact-edit',
      },
    );

    const list: { id: string; updatedAt: string }[] = await (
      await request.get('/api/artifacts')
    ).json();
    // Scope the ordering assertion to our artifacts (the DB is shared across
    // specs, so absolute position is meaningless here). `a` was bumped last, so
    // it must sort strictly ahead of the untouched `b` and `c`.
    const idx = (id: string) => list.findIndex((r) => r.id === id);
    expect(idx(a.artifactId)).toBeGreaterThanOrEqual(0);
    expect(idx(a.artifactId)).toBeLessThan(idx(b.artifactId));
    expect(idx(a.artifactId)).toBeLessThan(idx(c.artifactId));
    // The whole list is non-increasing in updatedAt (ties tolerated).
    const stamps = list.map((r) => new Date(r.updatedAt).getTime());
    expect([...stamps]).toEqual([...stamps].sort((x, y) => y - x));
  });

  test('workspaceIds=<id> returns only that workspace as documents', async ({
    request,
  }) => {
    const ws1 = await seedWorkspace(request, { name: uniq('ws1') });
    const ws2 = await seedWorkspace(request, { name: uniq('ws2') });
    const in1 = await seedArtifact(request, {
      title: uniq('In1'),
      workspaceId: ws1,
    });
    const in2 = await seedArtifact(request, {
      title: uniq('In2'),
      workspaceId: ws2,
    });
    const scoped = await seedArtifact(request, { title: uniq('Scoped') });

    const list: { id: string }[] = await (
      await request.get(`/api/artifacts?workspaceIds=${ws1}`)
    ).json();
    const ids = list.map((r) => r.id);
    expect(ids).toContain(in1.artifactId);
    expect(ids).not.toContain(in2.artifactId);
    expect(ids).not.toContain(scoped.artifactId);
  });

  test('workspaceIds=none returns only chat-scoped artifacts', async ({
    request,
  }) => {
    const ws = await seedWorkspace(request, { name: uniq('ws-none') });
    const owned = await seedArtifact(request, {
      title: uniq('OwnedNone'),
      workspaceId: ws,
    });
    const scoped = await seedArtifact(request, { title: uniq('ScopedNone') });

    const list: { id: string; workspaceId: string | null }[] = await (
      await request.get('/api/artifacts?workspaceIds=none')
    ).json();
    const ids = list.map((r) => r.id);
    expect(ids).toContain(scoped.artifactId);
    expect(ids).not.toContain(owned.artifactId);
    for (const row of list) expect(row.workspaceId).toBeNull();
  });

  test('workspaceIds=<id>,none returns the union', async ({ request }) => {
    const ws1 = await seedWorkspace(request, { name: uniq('ws-union') });
    const ws2 = await seedWorkspace(request, { name: uniq('ws-union2') });
    const owned1 = await seedArtifact(request, {
      title: uniq('U1'),
      workspaceId: ws1,
    });
    const owned2 = await seedArtifact(request, {
      title: uniq('U2'),
      workspaceId: ws2,
    });
    const scoped = await seedArtifact(request, { title: uniq('U3') });

    const list: { id: string }[] = await (
      await request.get(`/api/artifacts?workspaceIds=${ws1},none`)
    ).json();
    const ids = list.map((r) => r.id);
    expect(ids).toContain(owned1.artifactId);
    expect(ids).toContain(scoped.artifactId);
    expect(ids).not.toContain(owned2.artifactId);
  });

  test('a workspace document whose chat is gone returns chatTitle null', async ({
    request,
  }) => {
    const ws = await seedWorkspace(request, { name: uniq('orphan-ws') });
    const { chatId, artifactId } = await seedArtifact(request, {
      title: uniq('Orphan'),
      workspaceId: ws,
    });

    // Deleting the owning chat must not delete the workspace document; it only
    // loses its provenance pointer, so chatTitle comes back null.
    expect((await request.delete(`/api/chats/${chatId}`)).status()).toBe(200);

    const list: {
      id: string;
      chatId: string | null;
      chatTitle: string | null;
    }[] = await (await request.get(`/api/artifacts?workspaceIds=${ws}`)).json();
    const row = list.find((r) => r.id === artifactId);
    expect(row).toBeTruthy();
    expect(row!.chatId).toBeNull();
    expect(row!.chatTitle).toBeNull();
  });

  test('existing chatId and workspaceId modes behave unchanged', async ({
    request,
  }) => {
    const ws = await seedWorkspace(request, { name: uniq('existing-ws') });
    const owned = await seedArtifact(request, {
      title: uniq('ExistingOwned'),
      workspaceId: ws,
    });
    const scoped = await seedArtifact(request, {
      title: uniq('ExistingScoped'),
    });

    // chatId mode: scoped to the chat, summary shape with no chatTitle.
    const byChat: { id: string }[] = await (
      await request.get(`/api/artifacts?chatId=${scoped.chatId}`)
    ).json();
    expect(byChat).toHaveLength(1);
    expect(byChat[0]).toMatchObject({ id: scoped.artifactId });
    expect(byChat[0]).not.toHaveProperty('chatTitle');

    // workspaceId mode: only that workspace's documents.
    const byWs: { id: string }[] = await (
      await request.get(`/api/artifacts?workspaceId=${ws}`)
    ).json();
    expect(byWs).toHaveLength(1);
    expect(byWs[0]).toMatchObject({ id: owned.artifactId });
    expect(byWs[0]).not.toHaveProperty('chatTitle');
  });

  test('empty workspace list is a valid empty array, not an error', async ({
    request,
  }) => {
    const res = await request.get('/api/artifacts?workspaceIds=none');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
