import http, { type IncomingHttpHeaders } from 'node:http';

import { test, expect, type APIRequestContext } from '../fixtures/api';
import { uniq } from '../utils/helpers';

test.describe.configure({ mode: 'serial' });

type UpstreamRequest = {
  scenario: string;
  headers: IncomingHttpHeaders;
};

let upstream: http.Server;
let upstreamPort: number;
const upstreamRequests: UpstreamRequest[] = [];
const createdProviderIds: string[] = [];

function upstreamBaseUrl(): string {
  return `http://127.0.0.1:${upstreamPort}`;
}

function clearUpstreamRequests(): void {
  upstreamRequests.length = 0;
}

type ProviderResponse = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  supportsEmbeddings: boolean;
  headerNames: string[];
  [key: string]: unknown;
};

async function createProvider(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {},
): Promise<ProviderResponse> {
  const response = await request.post('/api/providers/openai-compatible', {
    data: {
      name: uniq('compatible'),
      baseUrl: upstreamBaseUrl(),
      enabled: false,
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  const provider = (await response.json()).provider as ProviderResponse;
  createdProviderIds.push(provider.id);
  return provider;
}

test.beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/v1/models') {
      res.writeHead(404).end();
      return;
    }

    const rawScenario = req.headers['x-test-scenario'];
    const scenario = typeof rawScenario === 'string' ? rawScenario : 'valid';
    upstreamRequests.push({ scenario, headers: req.headers });

    if (scenario === 'redirect') {
      res.writeHead(302, { Location: `${upstreamBaseUrl()}/v1/models` }).end();
      return;
    }
    if (scenario === 'http') {
      res
        .writeHead(401, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'secret upstream body' }));
      return;
    }
    if (scenario === 'json') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end('not-json');
      return;
    }
    if (scenario === 'shape') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ models: ['secret'] }));
      return;
    }
    if (scenario === 'timeout') return;
    const data = scenario === 'zero' ? [] : [{ id: 'local-model' }];
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ data }));
  });

  await new Promise<void>((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      const address = upstream.address();
      if (!address || typeof address === 'string') {
        throw new Error('upstream server did not expose a TCP address');
      }
      upstreamPort = address.port;
      resolve();
    });
  });
});

test.afterEach(async ({ request }) => {
  for (const id of createdProviderIds.splice(0)) {
    await request.delete(`/api/providers/openai-compatible/${id}`);
  }
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    upstream.close((error) => (error ? reject(error) : resolve()));
  });
});

test('creates, lists, and redacts an offline provider', async ({ request }) => {
  const provider = await createProvider(request, {
    name: '  Local Gateway  ',
    baseUrl: `${upstreamBaseUrl()}/`,
    supportsEmbeddings: true,
    headers: {
      Authorization: 'Bearer secret-token',
      'X-API-Key': 'api-secret',
    },
  });

  expect(provider.name).toBe('Local Gateway');
  expect(provider.baseUrl).toBe(`${upstreamBaseUrl()}/v1`);
  expect(provider.enabled).toBe(false);
  expect(provider.supportsEmbeddings).toBe(true);
  expect(provider.headerNames).toEqual(['Authorization', 'X-API-Key']);
  expect(provider).not.toHaveProperty('headers');
  expect(JSON.stringify(provider)).not.toContain('secret');

  const list = await request.get('/api/providers/openai-compatible');
  expect(list.status()).toBe(200);
  const listed = (await list.json()).providers.find(
    (candidate: { id: string }) => candidate.id === provider.id,
  );
  expect(listed).toMatchObject({
    id: provider.id,
    name: 'Local Gateway',
    baseUrl: `${upstreamBaseUrl()}/v1`,
  });
  expect(listed).not.toHaveProperty('headers');

  const detail = await request.get(
    `/api/providers/openai-compatible/${provider.id}`,
  );
  expect(detail.status()).toBe(200);
  expect((await detail.json()).provider).toMatchObject({
    id: provider.id,
    name: 'Local Gateway',
  });
});

test('allows duplicate URLs but rejects normalized duplicate names', async ({
  request,
}) => {
  const first = await createProvider(request, { name: 'Same Name' });
  const conflict = await request.post('/api/providers/openai-compatible', {
    data: {
      name: ' same name ',
      baseUrl: upstreamBaseUrl(),
      enabled: false,
    },
  });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toEqual({
    error: 'A provider with that name already exists',
  });

  const second = await createProvider(request, { name: 'Different Name' });
  expect(second.id).not.toBe(first.id);
  expect(second.baseUrl).toBe(first.baseUrl);

  const renameConflict = await request.patch(
    `/api/providers/openai-compatible/${second.id}`,
    { data: { name: ' SAME NAME ' } },
  );
  expect(renameConflict.status()).toBe(409);
  expect(await renameConflict.json()).toEqual({
    error: 'A provider with that name already exists',
  });
});

test('rejects invalid URLs and secret-header payloads at the API boundary', async ({
  request,
}) => {
  const cases: Array<{
    data: Record<string, unknown>;
    message: string;
  }> = [
    {
      data: { name: uniq('invalid'), baseUrl: 'ftp://example.com' },
      message: 'baseUrl must use http or https',
    },
    {
      data: { name: uniq('invalid'), baseUrl: `${upstreamBaseUrl()}/v2` },
      message: 'baseUrl must be an HTTP(S) root or end in /v1',
    },
    {
      data: {
        name: uniq('invalid'),
        baseUrl: `${upstreamBaseUrl()}/v1?token=secret`,
      },
      message: 'baseUrl must not contain a query or fragment',
    },
    {
      data: {
        name: uniq('invalid'),
        baseUrl: upstreamBaseUrl(),
        headers: {
          'X-Key': `value${String.fromCharCode(13, 10)}Injected: yes`,
        },
      },
      message: 'control characters',
    },
    {
      data: {
        name: uniq('invalid'),
        baseUrl: upstreamBaseUrl(),
        headers: { Host: 'example.com' },
      },
      message: 'controlled by the transport',
    },
  ];

  for (const { data, message } of cases) {
    const response = await request.post('/api/providers/openai-compatible', {
      data,
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain(message);
  }
});

test('enforces strict scalar and header-map validation on create and patch', async ({
  request,
}) => {
  const createCases: Array<{
    data: Record<string, unknown>;
    message: string;
  }> = [
    {
      data: { baseUrl: upstreamBaseUrl() },
      message: 'name is required',
    },
    {
      data: { name: uniq('invalid') },
      message: 'baseUrl is required',
    },
    {
      data: {
        name: uniq('invalid'),
        baseUrl: upstreamBaseUrl(),
        enabled: 'yes',
      },
      message: 'enabled must be a boolean',
    },
    {
      data: {
        name: uniq('invalid'),
        baseUrl: upstreamBaseUrl(),
        supportsEmbeddings: 'yes',
      },
      message: 'supportsEmbeddings must be a boolean',
    },
    {
      data: {
        name: uniq('invalid'),
        baseUrl: upstreamBaseUrl(),
        headers: ['Authorization'],
      },
      message: 'headers must be an object',
    },
  ];

  for (const { data, message } of createCases) {
    const response = await request.post('/api/providers/openai-compatible', {
      data,
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe(message);
  }

  const provider = await createProvider(request);
  const patchCases: Array<{
    data: Record<string, unknown>;
    message: string;
  }> = [
    {
      data: { enabled: 'no' },
      message: 'enabled must be a boolean',
    },
    {
      data: { supportsEmbeddings: 'no' },
      message: 'supportsEmbeddings must be a boolean',
    },
    {
      data: { headersPatch: ['X-Key'] },
      message: 'headersPatch must be an object',
    },
    {
      data: {
        headersPatch: { Authorization: 'one', authorization: 'two' },
      },
      message: 'duplicate header name: authorization',
    },
  ];

  for (const { data, message } of patchCases) {
    const response = await request.patch(
      `/api/providers/openai-compatible/${provider.id}`,
      { data },
    );
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe(message);
  }
});

test('preserves and removes individual encrypted headers through patches', async ({
  request,
}) => {
  const provider = await createProvider(request, {
    headers: {
      'X-Test-Scenario': 'valid',
      'X-Keep': 'first',
      'X-Remove': 'remove-me',
    },
  });

  const patch = await request.patch(
    `/api/providers/openai-compatible/${provider.id}`,
    {
      data: {
        name: ' Renamed Gateway ',
        headersPatch: {
          'X-Keep': 'second',
          'X-Remove': null,
          'X-Blank': '',
        },
      },
    },
  );
  expect(patch.status()).toBe(200);
  const patched = (await patch.json()).provider;
  expect(patched.name).toBe('Renamed Gateway');
  expect(patched.id).toBe(provider.id);
  expect(patched.headerNames.sort()).toEqual(['X-Keep', 'X-Test-Scenario']);

  clearUpstreamRequests();
  const testResponse = await request.post(
    `/api/providers/openai-compatible/${provider.id}/test`,
  );
  expect(testResponse.status()).toBe(200);
  expect(await testResponse.json()).toEqual({ ok: true, modelCount: 1 });

  expect(upstreamRequests).toHaveLength(1);
  expect(upstreamRequests[0].headers['x-keep']).toBe('second');
  expect(upstreamRequests[0].headers['x-test-scenario']).toBe('valid');
  expect(upstreamRequests[0].headers['x-remove']).toBeUndefined();
  expect(upstreamRequests[0].headers['x-blank']).toBeUndefined();
});

test('patches existing headers case-insensitively for replacement and removal', async ({
  request,
}) => {
  const provider = await createProvider(request, {
    headers: { Authorization: 'old-secret' },
  });

  const replaced = await request.patch(
    `/api/providers/openai-compatible/${provider.id}`,
    { data: { headersPatch: { authorization: 'new-secret' } } },
  );
  expect(replaced.status()).toBe(200);
  const replacedBody = (await replaced.json()).provider as ProviderResponse;
  expect(
    replacedBody.headerNames.filter(
      (name) => name.toLowerCase() === 'authorization',
    ),
  ).toHaveLength(1);

  clearUpstreamRequests();
  const replacementTest = await request.post(
    `/api/providers/openai-compatible/${provider.id}/test`,
  );
  expect(replacementTest.status()).toBe(200);
  expect(upstreamRequests[0]?.headers.authorization).toBe('new-secret');

  const removed = await request.patch(
    `/api/providers/openai-compatible/${provider.id}`,
    { data: { headersPatch: { AUTHORIZATION: null } } },
  );
  expect(removed.status()).toBe(200);
  expect((await removed.json()).provider.headerNames).toEqual([]);

  clearUpstreamRequests();
  const removalTest = await request.post(
    `/api/providers/openai-compatible/${provider.id}/test`,
  );
  expect(removalTest.status()).toBe(200);
  expect(upstreamRequests[0]?.headers.authorization).toBeUndefined();
});

test('serializes concurrent opposite-case header patches without duplicates', async ({
  request,
}) => {
  const provider = await createProvider(request, {
    headers: { Authorization: 'old-secret' },
  });
  const providerUrl = `/api/providers/openai-compatible/${provider.id}`;

  const [upperCasePatch, lowerCasePatch] = await Promise.all([
    request.patch(providerUrl, {
      data: { headersPatch: { Authorization: 'first-secret' } },
    }),
    request.patch(providerUrl, {
      data: { headersPatch: { authorization: 'second-secret' } },
    }),
  ]);

  expect(upperCasePatch.status()).toBe(200);
  expect(lowerCasePatch.status()).toBe(200);

  const detail = await request.get(providerUrl);
  expect(detail.status()).toBe(200);
  const headerNames = (await detail.json()).provider.headerNames as string[];
  expect(
    headerNames.filter((name) => name.toLowerCase() === 'authorization'),
  ).toHaveLength(1);

  clearUpstreamRequests();
  const testResponse = await request.post(`${providerUrl}/test`);
  expect(testResponse.status()).toBe(200);
  expect(['first-secret', 'second-secret']).toContain(
    upstreamRequests[0]?.headers.authorization,
  );
});

test('tests a disabled provider and treats zero discovered models as success', async ({
  request,
}) => {
  const provider = await createProvider(request, {
    headers: { 'X-Test-Scenario': 'zero' },
  });

  clearUpstreamRequests();
  const response = await request.post(
    `/api/providers/openai-compatible/${provider.id}/test`,
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, modelCount: 0 });
  expect(upstreamRequests).toHaveLength(1);
  expect(upstreamRequests[0].scenario).toBe('zero');
});

test('sanitizes redirect, HTTP, JSON, and shape failures', async ({
  request,
}) => {
  for (const scenario of ['redirect', 'http', 'json', 'shape']) {
    const provider = await createProvider(request, {
      headers: { 'X-Test-Scenario': scenario },
    });
    const response = await request.post(
      `/api/providers/openai-compatible/${provider.id}/test`,
    );

    expect(response.status()).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      error:
        scenario === 'redirect'
          ? 'Provider discovery rejected a redirect'
          : scenario === 'http'
            ? 'Provider returned an error response'
            : scenario === 'json'
              ? 'Provider returned invalid JSON'
              : 'Provider returned an invalid models response',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  }
});

test('sanitizes connection failures from the provider test route', async ({
  request,
}) => {
  const provider = await createProvider(request, {
    baseUrl: 'http://127.0.0.1:1',
    headers: { 'X-Upstream-Secret': 'must-not-escape' },
  });

  const response = await request.post(
    `/api/providers/openai-compatible/${provider.id}/test`,
  );
  expect(response.status()).toBe(502);
  expect(await response.json()).toEqual({
    error: 'Unable to connect to provider',
  });
});

test('maps a discovery timeout to a sanitized 504 response', async ({
  request,
}) => {
  test.setTimeout(35_000);
  const provider = await createProvider(request, {
    headers: { 'X-Test-Scenario': 'timeout' },
  });

  const response = await request.post(
    `/api/providers/openai-compatible/${provider.id}/test`,
  );
  expect(response.status()).toBe(504);
  expect(await response.json()).toEqual({
    error: 'Provider discovery timed out',
  });
});

test('returns 404 for missing resources and preserves identity on rename', async ({
  request,
}) => {
  const missing = '00000000-0000-0000-0000-000000000000';
  const missingUrl = `/api/providers/openai-compatible/${missing}`;
  const missingGet = await request.get(missingUrl);
  expect(missingGet.status()).toBe(404);
  expect(await missingGet.json()).toEqual({ error: 'Not found' });
  const missingPatch = await request.patch(missingUrl, {
    data: { name: 'missing' },
  });
  expect(missingPatch.status()).toBe(404);
  expect(await missingPatch.json()).toEqual({ error: 'Not found' });
  const missingDelete = await request.delete(missingUrl);
  expect(missingDelete.status()).toBe(404);
  expect(await missingDelete.json()).toEqual({ error: 'Not found' });
  const missingTest = await request.post(
    `/api/providers/openai-compatible/${missing}/test`,
  );
  expect(missingTest.status()).toBe(404);
  expect(await missingTest.json()).toEqual({ error: 'Not found' });

  const provider = await createProvider(request, { name: 'Before Rename' });
  const renamed = await request.patch(
    `/api/providers/openai-compatible/${provider.id}`,
    {
      data: {
        name: 'After Rename',
        baseUrl: `${upstreamBaseUrl()}/v1/`,
        enabled: true,
        supportsEmbeddings: true,
      },
    },
  );
  expect(renamed.status()).toBe(200);
  expect((await renamed.json()).provider).toMatchObject({
    id: provider.id,
    name: 'After Rename',
    baseUrl: `${upstreamBaseUrl()}/v1`,
    enabled: true,
    supportsEmbeddings: true,
  });

  const deleted = await request.delete(
    `/api/providers/openai-compatible/${provider.id}`,
  );
  expect(deleted.status()).toBe(200);
  expect(await deleted.json()).toEqual({ ok: true });
  expect(
    (
      await request.get(`/api/providers/openai-compatible/${provider.id}`)
    ).status(),
  ).toBe(404);
  const createdIndex = createdProviderIds.indexOf(provider.id);
  if (createdIndex >= 0) createdProviderIds.splice(createdIndex, 1);
});
