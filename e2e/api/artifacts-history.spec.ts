import { test, expect } from '../fixtures/api';
import {
  seedArtifact,
  seedGeneratedImage,
  seedLegacyImage,
  seedWorkspace,
  runArtifactTurn,
} from '../utils/seed';
import { uniq } from '../utils/helpers';

test.describe('artifact list-all (history tab) endpoint', () => {
  test('no filter returns every artifact across scopes, joined to chat titles', async ({
    request,
  }) => {
    const ws = await seedWorkspace(request, { name: uniq('hist-ws') });

    // A chat-scoped artifact (chat has no workspace).
    const scoped = await seedArtifact(request, { title: uniq('Scoped') });
    // A workspace-owned artifact (chat inside the workspace).
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

  test('workspaceIds=<id> returns only that workspace as artifacts', async ({
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

  test('a workspace artifact whose chat is gone returns chatTitle null', async ({
    request,
  }) => {
    const ws = await seedWorkspace(request, { name: uniq('orphan-ws') });
    const { chatId, artifactId } = await seedArtifact(request, {
      title: uniq('Orphan'),
      workspaceId: ws,
    });

    // Deleting the owning chat must not delete the workspace artifact; it only
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

    // workspaceId mode: only that workspace's artifacts.
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

test.describe('generated image history contract', () => {
  test('returns typed image provenance and orders it with pages by activity', async ({
    request,
  }) => {
    const page = await seedArtifact(request, { title: uniq('MixedPage') });
    const pageList = await (
      await request.get(`/api/artifacts?chatId=${page.chatId}`)
    ).json();
    const pageRow = pageList.find(
      (row: { id: string }) => row.id === page.artifactId,
    ) as { updatedAt: string };
    const image = await seedGeneratedImage(request, {
      prompt: 'A full provenance prompt for a lighthouse at dusk',
      assistantMessageId: uniq('assistant'),
      createdAt: new Date(Date.parse(pageRow.updatedAt) + 1000),
    });

    const res = await request.get('/api/artifacts?type=all');
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as Array<{
      id: string;
      type: 'page' | 'image';
      prompt?: string;
      assistantMessageId?: string;
      chatId: string | null;
      workspaceId: string | null;
      chatTitle: string | null;
      mimeType?: string;
      extension?: string;
      imageUrl?: string;
      createdAt: string;
    }>;
    const ours = rows.filter((row) =>
      [page.artifactId, image.id].includes(row.id),
    );

    expect(ours.map((row) => row.id)).toEqual([image.id, page.artifactId]);
    const imageRow = ours.find((row) => row.id === image.id);
    expect(imageRow).toMatchObject({
      type: 'image',
      prompt: image.prompt,
      assistantMessageId: image.assistantMessageId,
      chatId: image.chatId,
      workspaceId: null,
      mimeType: 'image/png',
      extension: 'png',
      imageUrl: `/api/uploads/images/${image.id}`,
    });
    expect(imageRow?.chatTitle).toBeTruthy();
    expect(new Date(imageRow!.createdAt).getTime()).toBeGreaterThan(
      new Date(pageRow.updatedAt).getTime(),
    );
  });

  test('filters pages and images and rejects an unknown type', async ({
    request,
  }) => {
    const page = await seedArtifact(request, { title: uniq('PagesOnly') });
    const image = await seedGeneratedImage(request, {
      prompt: uniq('ImagesOnly prompt'),
    });

    const pages = await (await request.get('/api/artifacts?type=pages')).json();
    expect(
      pages.filter((row: { id: string }) => row.id === page.artifactId),
    ).toHaveLength(1);
    expect(
      pages.filter((row: { id: string }) => row.id === image.id),
    ).toHaveLength(0);
    expect(pages.every((row: { type: string }) => row.type === 'page')).toBe(
      true,
    );

    const images = await (
      await request.get('/api/artifacts?type=images')
    ).json();
    expect(
      images.filter((row: { id: string }) => row.id === image.id),
    ).toHaveLength(1);
    expect(
      images.filter((row: { id: string }) => row.id === page.artifactId),
    ).toHaveLength(0);
    expect(images.every((row: { type: string }) => row.type === 'image')).toBe(
      true,
    );

    const invalid = await request.get('/api/artifacts?type=uploads');
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'type must be one of: all, pages, images',
    });
  });

  test('composes workspace and none filters across pages and images', async ({
    request,
  }) => {
    const workspaceOne = await seedWorkspace(request, {
      name: uniq('history-image-ws-one'),
    });
    const workspaceTwo = await seedWorkspace(request, {
      name: uniq('history-image-ws-two'),
    });
    const pageNone = await seedArtifact(request, { title: uniq('NonePage') });
    const pageOne = await seedArtifact(request, {
      title: uniq('OnePage'),
      workspaceId: workspaceOne,
    });
    const pageTwo = await seedArtifact(request, {
      title: uniq('TwoPage'),
      workspaceId: workspaceTwo,
    });
    const imageNone = await seedGeneratedImage(request, {
      prompt: uniq('NoneImage'),
    });
    const imageOne = await seedGeneratedImage(request, {
      prompt: uniq('OneImage'),
      workspaceId: workspaceOne,
    });
    const imageTwo = await seedGeneratedImage(request, {
      prompt: uniq('TwoImage'),
      workspaceId: workspaceTwo,
    });

    const ids = async (workspaceIds: string) => {
      const body = await (
        await request.get(
          `/api/artifacts?type=all&workspaceIds=${workspaceIds}`,
        )
      ).json();
      return (body as Array<{ id: string; workspaceId: string | null }>).filter(
        (row) =>
          [
            pageNone.artifactId,
            pageOne.artifactId,
            pageTwo.artifactId,
            imageNone.id,
            imageOne.id,
            imageTwo.id,
          ].includes(row.id),
      );
    };

    const one = await ids(workspaceOne);
    expect(one.map((row) => row.id).sort()).toEqual(
      [pageOne.artifactId, imageOne.id].sort(),
    );
    expect(one.every((row) => row.workspaceId === workspaceOne)).toBe(true);

    const none = await ids('none');
    expect(none.map((row) => row.id).sort()).toEqual(
      [pageNone.artifactId, imageNone.id].sort(),
    );
    expect(none.every((row) => row.workspaceId === null)).toBe(true);

    const union = await ids(`${workspaceOne},none`);
    expect(union.map((row) => row.id).sort()).toEqual(
      [
        pageNone.artifactId,
        pageOne.artifactId,
        imageNone.id,
        imageOne.id,
      ].sort(),
    );
    expect(union.map((row) => row.id)).not.toContain(pageTwo.artifactId);
    expect(union.map((row) => row.id)).not.toContain(imageTwo.id);
  });

  test('does not list a legacy or user-uploaded image without generated metadata', async ({
    request,
  }) => {
    const upload = await request.post('/api/uploads/images', {
      multipart: {
        images: {
          name: `${uniq('legacy')}.png`,
          mimeType: 'image/png',
          buffer: Buffer.from('legacy upload bytes'),
        },
      },
    });
    expect(upload.status()).toBe(200);
    const [{ imageId: uploadedImageId }] = (await upload.json()).images;
    const legacy = seedLegacyImage();
    expect((await request.get(legacy.imageUrl)).status()).toBe(200);

    const generated = await seedGeneratedImage(request, {
      prompt: uniq('Durable generated image'),
    });
    const rows = await (await request.get('/api/artifacts?type=images')).json();
    const ids = (rows as Array<{ id: string }>).map((row) => row.id);

    expect(ids).toContain(generated.id);
    expect(ids).not.toContain(uploadedImageId);
    expect(ids).not.toContain(legacy.imageId);
  });
});
