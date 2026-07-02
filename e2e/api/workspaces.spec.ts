import { test, expect } from '../fixtures/api';
import {
  seedWorkspace,
  seedWorkspaceFile,
  seedSystemPrompt,
} from '../utils/seed';

// ---------------------------------------------------------------------------
// GET /api/workspaces
// ---------------------------------------------------------------------------
test.describe('GET /api/workspaces', () => {
  test('returns a workspaces array', async ({ request }) => {
    const res = await request.get('/api/workspaces');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.workspaces)).toBe(true);
  });

  test('includes a seeded workspace', async ({ request }) => {
    const id = await seedWorkspace(request, { name: 'list-test' });
    const res = await request.get('/api/workspaces');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const found = body.workspaces.find((w: { id: string }) => w.id === id);
    expect(found).toBeDefined();
    expect(found.name).toBe('list-test');

    // archive it and check it disappears from active and appears with ?archived=true
    await request.post(`/api/workspaces/${id}/archive`);
    const active = await request.get('/api/workspaces');
    const activeIds = (await active.json()).workspaces.map(
      (w: { id: string }) => w.id,
    );
    expect(activeIds).not.toContain(id);

    const archived = await request.get('/api/workspaces?archived=true');
    const archivedBody = await archived.json();
    const archivedFound = archivedBody.workspaces.find(
      (w: { id: string }) => w.id === id,
    );
    expect(archivedFound).toBeDefined();
    expect(archivedFound.name).toBe('list-test');
    expect(archivedFound.archivedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces
// ---------------------------------------------------------------------------
test.describe('POST /api/workspaces', () => {
  test('rejects missing name with 400', async ({ request }) => {
    const res = await request.post('/api/workspaces', { data: {} });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'name required' });
  });

  test('rejects non-string name with 400', async ({ request }) => {
    const res = await request.post('/api/workspaces', {
      data: { name: 123 },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'name required' });
  });

  test('creates a workspace and returns it', async ({ request }) => {
    const name = `test-ws-${Date.now()}`;
    const res = await request.post('/api/workspaces', { data: { name } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('workspace');
    const ws = body.workspace;
    expect(ws.name).toBe(name);
    expect(typeof ws.id).toBe('string');
    expect(ws.id).not.toBe('');
    // timestamp columns serialize to ISO date strings
    expect(Number.isNaN(Date.parse(ws.createdAt))).toBe(false);
    expect(ws.sourceUrls).toEqual([]);
    expect(ws.archivedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/[id]
// ---------------------------------------------------------------------------
test.describe('GET /api/workspaces/[id]', () => {
  test('returns workspace shape', async ({ request }) => {
    const id = await seedWorkspace(request, { name: 'get-test' });
    const res = await request.get(`/api/workspaces/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('workspace');
    expect(body.workspace).toMatchObject({ id, name: 'get-test' });
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.get('/api/workspaces/nonexistent-id');
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/[id]
// ---------------------------------------------------------------------------
test.describe('PATCH /api/workspaces/[id]', () => {
  test('renames a workspace', async ({ request }) => {
    const id = await seedWorkspace(request, { name: 'before' });
    const res = await request.patch(`/api/workspaces/${id}`, {
      data: { name: 'after' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.workspace).toMatchObject({ id, name: 'after' });
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.patch('/api/workspaces/nonexistent-id', {
      data: { name: 'x' },
    });
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/workspaces/[id]
// ---------------------------------------------------------------------------
test.describe('DELETE /api/workspaces/[id]', () => {
  test('deletes with 204 and makes subsequent GET 404', async ({ request }) => {
    const id = await seedWorkspace(request, { name: 'delete-me' });
    const del = await request.delete(`/api/workspaces/${id}`);
    expect(del.status()).toBe(204);

    const get = await request.get(`/api/workspaces/${id}`);
    expect(get.status()).toBe(404);
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.delete('/api/workspaces/nonexistent-id');
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/[id]/archive
// ---------------------------------------------------------------------------
test.describe('POST /api/workspaces/[id]/archive', () => {
  test('archives workspace and sets archivedAt', async ({ request }) => {
    const id = await seedWorkspace(request, { name: 'archive-me' });
    const res = await request.post(`/api/workspaces/${id}/archive`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ws = body.workspace;
    expect(ws.name).toBe('archive-me');
    expect(ws.id).toBe(id);
    expect(ws.archivedAt).not.toBeNull();
    // archivedAt is a timestamp column → ISO date string when set
    expect(Number.isNaN(Date.parse(ws.archivedAt))).toBe(false);
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.post('/api/workspaces/nonexistent-id/archive');
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/[id]/unarchive
// ---------------------------------------------------------------------------
test.describe('POST /api/workspaces/[id]/unarchive', () => {
  test('unarchives workspace and nulls archivedAt', async ({ request }) => {
    const id = await seedWorkspace(request, { name: 'unarchive-me' });
    await request.post(`/api/workspaces/${id}/archive`);

    const res = await request.post(`/api/workspaces/${id}/unarchive`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ws = body.workspace;
    expect(ws.name).toBe('unarchive-me');
    expect(ws.id).toBe(id);
    expect(ws.archivedAt).toBeNull();
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.post('/api/workspaces/nonexistent-id/unarchive');
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/[id]/files
// ---------------------------------------------------------------------------
test.describe('GET /api/workspaces/[id]/files', () => {
  test('returns empty files array for new workspace', async ({ request }) => {
    const id = await seedWorkspace(request);
    const res = await request.get(`/api/workspaces/${id}/files`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ files: [] });
  });

  test('includes a seeded file', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, { name: 'note.txt' });
    const res = await request.get(`/api/workspaces/${wsId}/files`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const f = body.files.find((x: { id: string }) => x.id === fileId);
    expect(f).toBeDefined();
    expect(f.name).toBe('note.txt');
    expect(f.mime).toBe('text/plain');
    expect(f.size).toBe(17); // 'test file content'
    expect(f.isBinary).toBe(false);
  });

  test('returns 404 for nonexistent workspace', async ({ request }) => {
    const res = await request.get('/api/workspaces/nonexistent-id/files');
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/[id]/files
// ---------------------------------------------------------------------------
test.describe('POST /api/workspaces/[id]/files', () => {
  test('creates a file and returns file shape', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.post(`/api/workspaces/${wsId}/files`, {
      data: { name: 'hello.txt', content: 'hello world', mime: 'text/plain' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const f = body.file;
    expect(f).toBeDefined();
    expect(f.name).toBe('hello.txt');
    expect(f.workspaceId).toBe(wsId);
    expect(f.mime).toBe('text/plain');
    expect(f.size).toBe(11);
    expect(typeof f.id).toBe('string');
    expect(f.id).not.toBe('');
    expect(typeof f.sha256).toBe('string');
    expect(f.sha256).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  test('rejects missing name and content with 400', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.post(`/api/workspaces/${wsId}/files`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'name and content required' });
  });

  test('rejects duplicate name with 409', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    await seedWorkspaceFile(request, wsId, { name: 'dup.txt' });
    const res = await request.post(`/api/workspaces/${wsId}/files`, {
      data: { name: 'dup.txt', content: 'again' },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'name already exists' });
  });

  test('returns 404 for nonexistent workspace', async ({ request }) => {
    const res = await request.post('/api/workspaces/nonexistent-id/files', {
      data: { name: 'f.txt', content: 'x' },
    });
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/[id]/files/[fileId]
// ---------------------------------------------------------------------------
test.describe('GET /api/workspaces/[id]/files/[fileId]', () => {
  test('returns file with content and isBinary', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'read.txt',
      content: 'readable',
    });
    const res = await request.get(`/api/workspaces/${wsId}/files/${fileId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('readable');
    expect(body.isBinary).toBe(false);
    const f = body.file;
    expect(f.id).toBe(fileId);
    expect(f.name).toBe('read.txt');
    expect(f.mime).toBe('text/plain');
    expect(f.size).toBe(8);
  });

  test('returns 404 for nonexistent fileId', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.get(
      `/api/workspaces/${wsId}/files/nonexistent-file`,
    );
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });

  test('?raw=true returns the raw bytes with content-type header', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'raw.txt',
      content: 'raw-bytes-content',
    });
    const res = await request.get(
      `/api/workspaces/${wsId}/files/${fileId}?raw=true`,
    );
    expect(res.status()).toBe(200);
    // Content-Type should reflect the file's mime
    expect(res.headers()['content-type']).toBe('text/plain');
    // Body should be the raw bytes
    const body = await res.body();
    expect(body.toString('utf8')).toBe('raw-bytes-content');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/workspaces/[id]/files/[fileId]
// ---------------------------------------------------------------------------
test.describe('PUT /api/workspaces/[id]/files/[fileId]', () => {
  test('replaces file content', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'edit.txt',
      content: 'old',
    });
    const res = await request.put(`/api/workspaces/${wsId}/files/${fileId}`, {
      data: { content: 'new content' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const f = body.file;
    expect(f.id).toBe(fileId);
    expect(f.name).toBe('edit.txt');
    expect(f.size).toBe(11);

    // verify content was actually replaced
    const get = await request.get(`/api/workspaces/${wsId}/files/${fileId}`);
    expect((await get.json()).content).toBe('new content');
  });

  test('rejects missing content with 400', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'noedit.txt',
      content: 'x',
    });
    const res = await request.put(`/api/workspaces/${wsId}/files/${fileId}`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'content required' });
  });

  test('returns 404 for nonexistent fileId', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.put(
      `/api/workspaces/${wsId}/files/nonexistent-file`,
      { data: { content: 'x' } },
    );
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/workspaces/[id]/files/[fileId]
// ---------------------------------------------------------------------------
test.describe('DELETE /api/workspaces/[id]/files/[fileId]', () => {
  test('deletes file and returns ok', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, { name: 'gone.txt' });
    const res = await request.delete(`/api/workspaces/${wsId}/files/${fileId}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const get = await request.get(`/api/workspaces/${wsId}/files/${fileId}`);
    expect(get.status()).toBe(404);
  });

  test('returns 404 for nonexistent fileId', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.delete(
      `/api/workspaces/${wsId}/files/nonexistent-file`,
    );
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/[id]/files/[fileId]
// ---------------------------------------------------------------------------
test.describe('PATCH /api/workspaces/[id]/files/[fileId]', () => {
  test('sets autoAcceptEdits on a file', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, { name: 'aae.txt' });

    const set1 = await request.patch(
      `/api/workspaces/${wsId}/files/${fileId}`,
      { data: { autoAcceptEdits: 1 } },
    );
    expect(set1.status()).toBe(200);
    const f1 = (await set1.json()).file;
    expect(f1.autoAcceptEdits).toBe(1);
    expect(f1.name).toBe('aae.txt');

    const set0 = await request.patch(
      `/api/workspaces/${wsId}/files/${fileId}`,
      { data: { autoAcceptEdits: 0 } },
    );
    expect(set0.status()).toBe(200);
    const f0 = (await set0.json()).file;
    expect(f0.autoAcceptEdits).toBe(0);
    expect(f0.name).toBe('aae.txt');
  });

  test('rejects invalid autoAcceptEdits with 400', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, { name: 'bad.txt' });
    const res = await request.patch(`/api/workspaces/${wsId}/files/${fileId}`, {
      data: { autoAcceptEdits: 2 },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({
      error: 'autoAcceptEdits must be 0, 1, or null',
    });
  });

  test('accepts autoAcceptEdits: null', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'null-aae.txt',
    });
    const res = await request.patch(`/api/workspaces/${wsId}/files/${fileId}`, {
      data: { autoAcceptEdits: null },
    });
    expect(res.status()).toBe(200);
    const f = (await res.json()).file;
    expect(f.autoAcceptEdits).toBeNull();
    expect(f.name).toBe('null-aae.txt');
  });

  test('returns 404 for nonexistent fileId', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.patch(
      `/api/workspaces/${wsId}/files/nonexistent-file`,
      { data: { autoAcceptEdits: 1 } },
    );
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/[id]/urls
// ---------------------------------------------------------------------------
test.describe('GET /api/workspaces/[id]/urls', () => {
  test('returns urls array', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.get(`/api/workspaces/${wsId}/urls`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ urls: [] });
  });

  test('returns seeded URLs with exact values', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const urls = ['https://a.example', 'https://b.example'];
    await request.put(`/api/workspaces/${wsId}/urls`, { data: { urls } });

    const res = await request.get(`/api/workspaces/${wsId}/urls`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.urls).toEqual(urls);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/workspaces/[id]/urls
// ---------------------------------------------------------------------------
test.describe('PUT /api/workspaces/[id]/urls', () => {
  test('sets urls and returns them', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const urls = ['https://example.com', 'https://test.example'];
    const res = await request.put(`/api/workspaces/${wsId}/urls`, {
      data: { urls },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('urls');
    expect(body.urls).toEqual(urls);
  });

  test('rejects missing urls array with 400', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.put(`/api/workspaces/${wsId}/urls`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'urls[] required' });
  });

  test('rejects invalid URL with 400', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.put(`/api/workspaces/${wsId}/urls`, {
      data: { urls: ['not a url'] },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid URL: not a url' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspaces/[id]/urls/check
// ---------------------------------------------------------------------------
test.describe('POST /api/workspaces/[id]/urls/check', () => {
  test('rejects missing url with 400', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.post(`/api/workspaces/${wsId}/urls/check`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'url required' });
  });

  // Success path requires outbound network (checkReachable does fetch)
  // and is skipped to keep tests network-independent.
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/[id]/system-prompts
// ---------------------------------------------------------------------------
test.describe('GET /api/workspaces/[id]/system-prompts', () => {
  test('returns links array', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.get(`/api/workspaces/${wsId}/system-prompts`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ links: [] });
  });

  test('includes attached system prompt links', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const spId = await seedSystemPrompt(request, { name: 'sp-test' });

    await request.put(`/api/workspaces/${wsId}/system-prompts`, {
      data: { ids: [spId] },
    });

    const res = await request.get(`/api/workspaces/${wsId}/system-prompts`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.links).toEqual([{ systemPromptId: spId, order: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/workspaces/[id]/system-prompts
// ---------------------------------------------------------------------------
test.describe('PUT /api/workspaces/[id]/system-prompts', () => {
  test('sets system prompt links and returns ok', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const spId = await seedSystemPrompt(request);

    const res = await request.put(`/api/workspaces/${wsId}/system-prompts`, {
      data: { ids: [spId] },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('rejects missing ids array with 400', async ({ request }) => {
    const wsId = await seedWorkspace(request);
    const res = await request.put(`/api/workspaces/${wsId}/system-prompts`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ids[] required' });
  });
});
