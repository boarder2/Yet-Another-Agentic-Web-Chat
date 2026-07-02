import { test, expect } from '../fixtures/api';
import { uniq } from '../utils/helpers';

test.describe('POST /api/mcp/servers', () => {
  test('creates a server with valid name and url', async ({ request }) => {
    const name = uniq('mcp');
    const res = await request.post('/api/mcp/servers', {
      data: { name, url: 'https://example.com/mcp' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('server');
    expect(body.server.name).toBe(name);
    expect(body.server.url).toBe('https://example.com/mcp');
    expect(typeof body.server.id).toBe('string');
    expect(body.server.id.length).toBeGreaterThan(0);
  });

  test('rejects missing name with 400', async ({ request }) => {
    const res = await request.post('/api/mcp/servers', {
      data: { url: 'https://example.com/mcp' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'name required' });
  });

  test('rejects name with wrong type with 400', async ({ request }) => {
    const res = await request.post('/api/mcp/servers', {
      data: { name: 123, url: 'https://example.com/mcp' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'name required' });
  });

  test('rejects missing url with 400', async ({ request }) => {
    const res = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp') },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'url required' });
  });

  test('rejects url with wrong type with 400', async ({ request }) => {
    const res = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp'), url: { host: 'example.com' } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'url required' });
  });

  test('rejects invalid url with 400', async ({ request }) => {
    const res = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp'), url: 'not a url' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'url is not a valid URL' });
  });

  test('rejects non-http scheme with 400', async ({ request }) => {
    const res = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp'), url: 'ftp://example.com/mcp' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'url must use http or https' });
  });

  test('rejects duplicate name with 409', async ({ request }) => {
    const name = uniq('mcp-dup');
    await request.post('/api/mcp/servers', {
      data: { name, url: 'https://example.com/mcp' },
    });
    const res = await request.post('/api/mcp/servers', {
      data: { name, url: 'https://example.com/mcp2' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body).toEqual({
      error: 'A server with that name already exists',
    });
  });

  test('creates a server with enabled set to false', async ({ request }) => {
    const name = uniq('mcp-off');
    const res = await request.post('/api/mcp/servers', {
      data: { name, url: 'https://example.com/mcp', enabled: false },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.server.enabled).toBe(false);
    expect(body.server.name).toBe(name);
  });

  test('defaults enabled to true when omitted', async ({ request }) => {
    const name = uniq('mcp-def');
    const res = await request.post('/api/mcp/servers', {
      data: { name, url: 'https://example.com/mcp' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    // enabled defaults to true via `body.enabled !== false`.
    expect(body.server.enabled).toBe(true);
  });

  test('persists optional fields and redacts secrets', async ({ request }) => {
    const name = uniq('mcp-full');
    const res = await request.post('/api/mcp/servers', {
      data: {
        name,
        url: 'https://example.com/mcp',
        transport: 'sse',
        authType: 'bearer',
        headerName: 'X-API-Key',
        secretToken: 'sk-secret-value-123',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();

    expect(body.server.name).toBe(name);
    expect(body.server.url).toBe('https://example.com/mcp');
    expect(body.server.transport).toBe('sse');
    expect(body.server.authType).toBe('bearer');
    // Secrets are redacted — the token and secret are never sent to the client.
    expect(body.server.hasToken).toBe(true);
    expect(body.server.hasSecret).toBe(false);
    // The raw secretToken must not leak.
    expect(body.server).not.toHaveProperty('secretToken');
    expect(body.server).not.toHaveProperty('oauthClientSecret');
  });

  test('redacts oauthClientSecret when provided', async ({ request }) => {
    const name = uniq('mcp-oauth');
    const res = await request.post('/api/mcp/servers', {
      data: {
        name,
        url: 'https://example.com/mcp',
        authType: 'oauth_client_credentials',
        oauthClientId: 'client-id-1',
        oauthClientSecret: 'secret-xyz',
        oauthScope: 'read write',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();

    expect(body.server.authType).toBe('oauth_client_credentials');
    expect(body.server.oauthClientId).toBe('client-id-1');
    expect(body.server.oauthScope).toBe('read write');
    expect(body.server.hasSecret).toBe(true);
    expect(body.server.hasToken).toBe(false);
    expect(body.server).not.toHaveProperty('oauthClientSecret');
    expect(body.server).not.toHaveProperty('secretToken');
  });
});

test.describe('GET /api/mcp/servers', () => {
  test('returns servers array including a created server', async ({
    request,
  }) => {
    const name = uniq('mcp-list');
    const createRes = await request.post('/api/mcp/servers', {
      data: { name, url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.get('/api/mcp/servers');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.servers)).toBe(true);

    const found = body.servers.find((s: { id: string }) => s.id === created.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe(name);
    expect(found.url).toBe('https://example.com/mcp');
  });

  test('returns servers seeded with all optional fields intact', async ({
    request,
  }) => {
    const name = uniq('mcp-full-list');
    const createRes = await request.post('/api/mcp/servers', {
      data: {
        name,
        url: 'https://example.com/mcp',
        transport: 'streamableHttp',
        authType: 'bearer',
        headerName: 'Authorization',
        secretToken: 'tok-123',
      },
    });
    const created = (await createRes.json()).server;

    const res = await request.get('/api/mcp/servers');
    expect(res.status()).toBe(200);
    const body = await res.json();

    const found = body.servers.find((s: { id: string }) => s.id === created.id);
    expect(found).toBeTruthy();
    expect(found.transport).toBe('streamableHttp');
    expect(found.authType).toBe('bearer');
    expect(found.hasToken).toBe(true);
    // Header name is stored but not considered a secret — it's visible.
    expect(found.headerName).toBe('Authorization');
  });
});

test.describe('GET /api/mcp/servers/[id]', () => {
  test('returns a created server by id', async ({ request }) => {
    const name = uniq('mcp-get');
    const createRes = await request.post('/api/mcp/servers', {
      data: { name, url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.get(`/api/mcp/servers/${created.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.server.id).toBe(created.id);
    expect(body.server.name).toBe(name);
    expect(body.server.url).toBe('https://example.com/mcp');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.get(
      '/api/mcp/servers/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
  });

  test('returns 404 for non-UUID id', async ({ request }) => {
    const res = await request.get('/api/mcp/servers/not-even-a-uuid');
    expect(res.status()).toBe(404);
    const body = await res.json();
    // The id doesn't match any row; the handler returns 404 regardless of format.
    expect(body).toEqual({ error: 'Not found' });
  });
});

test.describe('PATCH /api/mcp/servers/[id]', () => {
  test('updates the server name', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-upd'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;
    const newName = uniq('mcp-renamed');

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { name: newName },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.server.name).toBe(newName);
    expect(body.server.id).toBe(created.id);
    // Other fields unchanged.
    expect(body.server.url).toBe('https://example.com/mcp');
  });

  test('updates the server url', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-url'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { url: 'https://new.example.com/mcp' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.server.url).toBe('https://new.example.com/mcp');
    expect(body.server.name).toBe(created.name);
  });

  test('updates transport and authType together', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-tx'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { transport: 'sse', authType: 'bearer' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.server.transport).toBe('sse');
    expect(body.server.authType).toBe('bearer');
    // Changing transport/auth invalidates resolvedTransport.
  });

  test('rejects invalid url with 400', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-badurl'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { url: 'not a url' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'url is not a valid URL' });
  });

  test('rejects non-http scheme url with 400', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-scheme'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { url: 'ftp://example.com/mcp' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'url must use http or https' });
  });

  test('coerces enabled to a strict boolean', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-enbl'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    // Disable
    const res1 = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { enabled: false },
    });
    expect(res1.status()).toBe(200);
    const s1 = (await res1.json()).server;
    expect(s1.enabled).toBe(false);

    // Re-enable
    const res2 = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { enabled: true },
    });
    expect(res2.status()).toBe(200);
    const s2 = (await res2.json()).server;
    expect(s2.enabled).toBe(true);

    // Falsy non-boolean should coerce to false
    const res3 = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { enabled: 0 },
    });
    expect(res3.status()).toBe(200);
    const s3 = (await res3.json()).server;
    expect(s3.enabled).toBe(false);
  });

  test('returns 404 when patching a nonexistent id', async ({ request }) => {
    const res = await request.patch(
      '/api/mcp/servers/00000000-0000-0000-0000-000000000000',
      { data: { name: 'nope' } },
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
  });

  test('rejects unique name violation on update with 409', async ({
    request,
  }) => {
    const nameA = uniq('mcp-uq-a');
    const nameB = uniq('mcp-uq-b');
    await request.post('/api/mcp/servers', {
      data: { name: nameA, url: 'https://example.com/a' },
    });
    const b = await request.post('/api/mcp/servers', {
      data: { name: nameB, url: 'https://example.com/b' },
    });
    const bId = (await b.json()).server.id;

    const res = await request.patch(`/api/mcp/servers/${bId}`, {
      data: { name: nameA },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body).toEqual({
      error: 'A server with that name already exists',
    });
  });

  test('persists headerName and secretToken updates with redaction', async ({
    request,
  }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-sec'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: {
        authType: 'bearer',
        headerName: 'X-Auth',
        secretToken: 'new-secret-token',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.server.authType).toBe('bearer');
    expect(body.server.hasToken).toBe(true);
    expect(body.server).not.toHaveProperty('secretToken');
  });

  // -- toolConfigPatch validation branches -----------------------------------

  test('rejects toolConfigPatch that is not an object', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-tc'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { toolConfigPatch: ['not an object'] },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'toolConfigPatch must be an object' });
  });

  test('rejects toolConfigPatch with a null value', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-tc-null'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { toolConfigPatch: null },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'toolConfigPatch must be an object' });
  });

  test('rejects toolConfigPatch with a reserved key', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-proto'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    // __proto__ in a JS object literal sets the prototype, not an own key, so
    // the JSON serializer drops it. Send a raw JSON string instead so the key
    // survives serialization and reaches the server's validation guard.
    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      headers: { 'content-type': 'application/json' },
      data: '{"toolConfigPatch":{"__proto__":{"enabled":true}}}',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'invalid tool name: __proto__' });
  });

  test('rejects toolConfigPatch entry that is not an object or null', async ({
    request,
  }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-arr'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { toolConfigPatch: { myTool: 'not-an-object' } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'each toolConfig entry must be an object or null',
    });
  });

  test('rejects toolConfigPatch entry with non-boolean enabled', async ({
    request,
  }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-enb'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { toolConfigPatch: { myTool: { enabled: 'yes' } } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'toolConfig entry "enabled" must be a boolean',
    });
  });

  test('rejects toolConfigPatch entry with invalid approval value', async ({
    request,
  }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-appr'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { toolConfigPatch: { myTool: { approval: 'sometimes' } } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'toolConfig entry "approval" must be "always" or "never"',
    });
  });

  test('applies a valid toolConfigPatch and persists it', async ({
    request,
  }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-tc-ok'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    // Enable one tool and set another to auto-approve.
    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: {
        toolConfigPatch: {
          tool_a: { enabled: true },
          tool_b: { enabled: false, approval: 'never' },
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.server.toolConfig).toBeTruthy();
    expect(body.server.toolConfig.tool_a).toEqual({ enabled: true });
    expect(body.server.toolConfig.tool_b).toEqual({
      enabled: false,
      approval: 'never',
    });
  });

  test('removes a tool config entry via null value', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-tc-rm'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    // First, add an entry.
    await request.patch(`/api/mcp/servers/${created.id}`, {
      data: {
        toolConfigPatch: { tool_x: { enabled: false } },
      },
    });

    // Then delete it with null.
    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { toolConfigPatch: { tool_x: null } },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // After json_patch removes the null key, the entry should be gone.
    expect(body.server.toolConfig).not.toHaveProperty('tool_x');
  });

  test('rejects toolConfigPatch with too many entries', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-tc-big'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    // Build an object with 201 entries (exceeds TOOL_CONFIG_MAX_ENTRIES = 200).
    const big: Record<string, { enabled: boolean }> = {};
    for (let i = 0; i < 201; i++) {
      big[`tool_${i}`] = { enabled: true };
    }

    const res = await request.patch(`/api/mcp/servers/${created.id}`, {
      data: { toolConfigPatch: big },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('toolConfigPatch has too many entries');
  });
});

test.describe('DELETE /api/mcp/servers/[id]', () => {
  test('deletes a server and returns ok', async ({ request }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: { name: uniq('mcp-del'), url: 'https://example.com/mcp' },
    });
    const created = (await createRes.json()).server;

    const res = await request.delete(`/api/mcp/servers/${created.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Subsequent GET returns 404
    const getRes = await request.get(`/api/mcp/servers/${created.id}`);
    expect(getRes.status()).toBe(404);
  });

  test('returns ok for nonexistent id (idempotent delete)', async ({
    request,
  }) => {
    // DELETE is idempotent — deleting a resource that does not exist is not an
    // error. The handler always returns 200 { ok: true }.
    const res = await request.delete(
      '/api/mcp/servers/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});

test.describe('DELETE /api/mcp/servers (collection)', () => {
  test('returns 405 Method Not Allowed', async ({ request }) => {
    const res = await request.delete('/api/mcp/servers');
    expect(res.status()).toBe(405);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Use DELETE /api/mcp/servers/:id',
    });
  });
});

test.describe('POST /api/mcp/servers/[id]/test', () => {
  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.post(
      '/api/mcp/servers/00000000-0000-0000-0000-000000000000/test',
    );
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  // An unreachable host fails the StreamableHTTP probe and falls back to SSE,
  // whose EventSource auto-reconnects forever — the transport must be closed on
  // connect failure so it doesn't leak a retrying connection. The endpoint must
  // resolve promptly with a single 'error' result rather than hang or retry.
  test('reports error for an unreachable server without hanging', async ({
    request,
  }) => {
    const createRes = await request.post('/api/mcp/servers', {
      data: {
        name: uniq('mcp-unreachable'),
        url: 'https://new.example.com/mcp',
      },
    });
    const created = (await createRes.json()).server;

    const start = Date.now();
    const res = await request.post(`/api/mcp/servers/${created.id}/test`);
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.toolCount).toBe(0);
    expect(body.toolNames).toEqual([]);
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    // The connect path self-bounds at 5s; a leaking retry loop would blow past it.
    expect(elapsed).toBeLessThan(15000);
  });
});
