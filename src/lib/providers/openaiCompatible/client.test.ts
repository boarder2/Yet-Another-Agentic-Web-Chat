import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/encryption';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  createOpenAICompatibleChatModel,
  createOpenAICompatibleEmbeddingModel,
  discoverOpenAICompatibleModels,
  invalidateOpenAICompatibleProviderDiscovery,
  normalizeOpenAICompatibleChatBody,
  OPENAI_COMPATIBLE_DISCOVERY_TIMEOUT_MS,
  OpenAICompatibleDiscoveryError,
  parseOpenAICompatibleModels,
} from './client';
import type { OpenAICompatibleProviderRow } from './types';

const provider = (
  overrides: Partial<OpenAICompatibleProviderRow> = {},
): OpenAICompatibleProviderRow =>
  ({
    id: 'provider-1',
    name: 'Provider',
    normalizedName: 'provider',
    baseUrl: 'https://example.com/v1',
    enabled: true,
    supportsEmbeddings: false,
    headers: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as OpenAICompatibleProviderRow;

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function streamingResponse(): Response {
  const chunks = [
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-5.4',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'Hello' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-5.4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function requestParts(fetchMock: ReturnType<typeof vi.fn>): {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: Record<string, unknown>;
} {
  const [input, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
  return {
    url: String(input),
    init,
    headers: new Headers(init.headers),
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

beforeEach(() => {
  invalidateOpenAICompatibleProviderDiscovery();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  invalidateOpenAICompatibleProviderDiscovery();
});

describe('parseOpenAICompatibleModels', () => {
  it('accepts standard model descriptors and a valid empty catalog', () => {
    expect(
      parseOpenAICompatibleModels({
        data: [{ id: 'model-a' }, { id: 'model-b', name: 'Model B' }],
      }),
    ).toEqual([{ id: 'model-a' }, { id: 'model-b', name: 'Model B' }]);
    expect(parseOpenAICompatibleModels({ data: [] })).toEqual([]);
  });

  it.each([
    undefined,
    null,
    {},
    { data: {} },
    { data: [null] },
    { data: [{ id: '' }] },
    { data: [{ id: 'same' }, { id: 'same' }] },
    { data: [{ id: 'model', name: 42 }] },
  ])('rejects malformed response %j', (value) => {
    expect(() => parseOpenAICompatibleModels(value)).toThrowError(
      OpenAICompatibleDiscoveryError,
    );
    expect(() => parseOpenAICompatibleModels(value)).toThrowError(
      'Provider returned an invalid models response',
    );
  });
});

describe('discoverOpenAICompatibleModels', () => {
  it('uses the canonical models URL, custom headers, and no-redirect fetches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response(200, { data: [{ id: 'model-a', name: 'A' }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const models = await discoverOpenAICompatibleModels(
      provider({
        baseUrl: 'https://example.com/v1/',
        headers: { Authorization: 'Bearer secret', 'X-API-Key': 'key' },
      }),
      { forceRefresh: true, cacheResult: false },
    );

    expect(models).toEqual([{ id: 'model-a', name: 'A' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer secret',
          'X-API-Key': 'key',
          Accept: 'application/json',
        },
      }),
    );
  });

  it('treats an empty catalog as a successful discovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response(200, { data: [] })),
    );

    await expect(
      discoverOpenAICompatibleModels(provider(), {
        forceRefresh: true,
        cacheResult: false,
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    [302, { error: 'redirect secret' }, 'redirect'],
    [401, { error: 'upstream secret' }, 'http'],
  ] as const)(
    'sanitizes %s responses as %s errors',
    async (status, body, kind) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status, body)));

      let caught: unknown;
      try {
        await discoverOpenAICompatibleModels(provider(), {
          forceRefresh: true,
          cacheResult: false,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(OpenAICompatibleDiscoveryError);
      const discoveryError = caught as OpenAICompatibleDiscoveryError;
      expect(discoveryError).toMatchObject({ kind });
      expect(discoveryError.message).not.toContain('secret');
    },
  );

  it('classifies invalid JSON, invalid shape, and connection failures', async () => {
    const cases: Array<{
      fetchResult: Response | Error;
      kind: OpenAICompatibleDiscoveryError['kind'];
    }> = [
      {
        fetchResult: {
          status: 200,
          ok: true,
          json: vi.fn().mockRejectedValue(new Error('upstream secret body')),
        } as unknown as Response,
        kind: 'json',
      },
      {
        fetchResult: response(200, { models: ['secret'] }),
        kind: 'shape',
      },
      {
        fetchResult: new Error('ECONNREFUSED secret-host'),
        kind: 'connection',
      },
    ];

    for (const { fetchResult, kind } of cases) {
      vi.stubGlobal(
        'fetch',
        fetchResult instanceof Error
          ? vi.fn().mockRejectedValue(fetchResult)
          : vi.fn().mockResolvedValue(fetchResult),
      );

      let caught: unknown;
      try {
        await discoverOpenAICompatibleModels(provider(), {
          forceRefresh: true,
          cacheResult: false,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(OpenAICompatibleDiscoveryError);
      const discoveryError = caught as OpenAICompatibleDiscoveryError;
      expect(discoveryError).toMatchObject({ kind });
      expect(discoveryError.message).not.toContain('secret');
      vi.unstubAllGlobals();
    }
  });

  it('aborts discovery at the 20-second timeout and classifies it safely', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('operation aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = discoverOpenAICompatibleModels(provider(), {
      forceRefresh: true,
      cacheResult: false,
    });
    const rejection = expect(pending).rejects.toMatchObject({
      kind: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(OPENAI_COMPATIBLE_DISCOVERY_TIMEOUT_MS);

    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent discovery for the same provider revision', async () => {
    let resolveResponse!: (value: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = discoverOpenAICompatibleModels(provider());
    const second = discoverOpenAICompatibleModels(provider());
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveResponse(response(200, { data: [{ id: 'shared-model' }] }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: 'shared-model' }],
      [{ id: 'shared-model' }],
    ]);
  });

  it('caches successful results by provider revision and invalidates them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { data: [{ id: 'first' }] }))
      .mockResolvedValueOnce(response(200, { data: [{ id: 'updated' }] }))
      .mockResolvedValueOnce(response(200, { data: [{ id: 'invalidated' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverOpenAICompatibleModels(provider())).resolves.toEqual([
      { id: 'first' },
    ]);
    await expect(discoverOpenAICompatibleModels(provider())).resolves.toEqual([
      { id: 'first' },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();

    await expect(
      discoverOpenAICompatibleModels(provider({ updatedAt: new Date(1) })),
    ).resolves.toEqual([{ id: 'updated' }]);
    invalidateOpenAICompatibleProviderDiscovery(provider().id);
    await expect(
      discoverOpenAICompatibleModels(provider({ updatedAt: new Date(1) })),
    ).resolves.toEqual([{ id: 'invalidated' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('bypasses a cached result when a force refresh is requested', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { data: [{ id: 'cached' }] }))
      .mockResolvedValueOnce(response(200, { data: [{ id: 'refreshed' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverOpenAICompatibleModels(provider())).resolves.toEqual([
      { id: 'cached' },
    ]);
    await expect(
      discoverOpenAICompatibleModels(provider(), { forceRefresh: true }),
    ).resolves.toEqual([{ id: 'refreshed' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retain a transient uncached result for later catalog reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { data: [{ id: 'test-only' }] }))
      .mockResolvedValueOnce(response(200, { data: [{ id: 'fresh' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await discoverOpenAICompatibleModels(provider(), { cacheResult: false });
    await expect(discoverOpenAICompatibleModels(provider())).resolves.toEqual([
      { id: 'fresh' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('OpenAI-compatible runtime factories', () => {
  it('removes non-tool message names from compatible Chat Completions bodies', () => {
    const body = JSON.stringify({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', name: 'system', content: 'Instructions' },
        {
          role: 'user',
          name: 'user',
          content: [{ type: 'text', text: 'Hello', name: 'nested' }],
          metadata: { name: 'metadata' },
        },
        {
          role: 'assistant',
          name: 'model',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'web_search',
                arguments: '{"query":"Hello"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'web_search',
          tool_call_id: 'call-1',
          content: 'Results',
        },
      ],
    });

    const normalized = JSON.parse(
      normalizeOpenAICompatibleChatBody(body) ?? '',
    ) as { messages: Array<Record<string, unknown>> };

    expect(normalized.messages[0]).not.toHaveProperty('name');
    expect(normalized.messages[1]).not.toHaveProperty('name');
    expect(normalized.messages[1].content).toEqual([
      { type: 'text', text: 'Hello', name: 'nested' },
    ]);
    expect(normalized.messages[1].metadata).toEqual({ name: 'metadata' });
    expect(normalized.messages[2]).not.toHaveProperty('name');
    expect(normalized.messages[2].tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'web_search',
          arguments: '{"query":"Hello"}',
        },
      },
    ]);
    expect(normalized.messages[3]).toHaveProperty('name', 'web_search');
  });

  it('preserves the original body when no non-tool message names need normalization', () => {
    const body = JSON.stringify({
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'tool', name: 'web_search', content: 'Results' },
      ],
    });

    expect(normalizeOpenAICompatibleChatBody(body)).toBe(body);
    expect(normalizeOpenAICompatibleChatBody('not json')).toBe('not json');
    expect(normalizeOpenAICompatibleChatBody(undefined)).toBeUndefined();
  });

  it('normalizes serialized LangChain tool continuations without mutating messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const messages = [
      new SystemMessage({ content: 'Instructions', name: 'system' }),
      new HumanMessage({ content: 'Search', name: 'user' }),
      new AIMessage({
        content: '',
        name: 'model',
        tool_calls: [
          {
            id: 'call-1',
            name: 'web_search',
            args: { query: 'Search' },
            type: 'tool_call',
          },
        ],
      }),
      new ToolMessage({
        content: 'Results',
        name: 'web_search',
        tool_call_id: 'call-1',
      }),
    ];

    const model = createOpenAICompatibleChatModel(
      provider({ headers: {} }),
      'gpt-5.4',
    );
    for await (const _chunk of await model.stream(messages)) {
      // Consume the stream so the request completes.
    }

    const { body } = requestParts(fetchMock);
    const sentMessages = body.messages as Array<Record<string, unknown>>;
    expect(sentMessages[0]).not.toHaveProperty('name');
    expect(sentMessages[1]).not.toHaveProperty('name');
    expect(sentMessages[2]).not.toHaveProperty('name');
    expect(sentMessages[2].tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'web_search',
          arguments: '{"query":"Search"}',
        },
      },
    ]);
    expect(sentMessages[3]).toHaveProperty('name', 'web_search');
    expect(sentMessages[3]).toHaveProperty('tool_call_id', 'call-1');

    expect(messages[0].name).toBe('system');
    expect(messages[1].name).toBe('user');
    expect(messages[2].name).toBe('model');
    expect(messages[3].name).toBe('web_search');
  });

  it('forces streaming Chat Completions and applies configured headers without ambient OpenAI credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'ambient-api-key');
    vi.stubEnv('OPENAI_ORG_ID', 'ambient-org');
    vi.stubEnv('OPENAI_PROJECT_ID', 'ambient-project');
    vi.stubEnv(
      'OPENAI_CUSTOM_HEADERS',
      'X-Ambient: ambient-value\nAuthorization: Bearer ambient-header',
    );
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const model = createOpenAICompatibleChatModel(
      provider({
        headers: {
          Authorization: encrypt('Bearer configured'),
          'X-API-Key': encrypt('configured-key'),
        },
      }),
      'gpt-5.4',
    ) as BaseChatModel & { useResponsesApi?: boolean };

    expect(model.useResponsesApi).toBe(false);
    expect((model as unknown as { streaming: boolean }).streaming).toBe(true);

    const chunks = [];
    for await (const chunk of await model.stream('hello')) chunks.push(chunk);
    expect(chunks.map((chunk) => String(chunk.content)).join('')).toBe('Hello');

    const { url, init, headers, body } = requestParts(fetchMock);
    expect(url).toBe('https://example.com/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(headers.get('authorization')).toBe('Bearer configured');
    expect(headers.get('x-api-key')).toBe('configured-key');
    expect(headers.get('x-ambient')).toBeNull();
    expect(headers.get('openai-organization')).toBeNull();
    expect(headers.get('openai-project')).toBeNull();
    expect(body).toMatchObject({
      model: 'gpt-5.4',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('sends no Authorization when a compatible provider has no auth header', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'ambient-api-key');
    vi.stubEnv('OPENAI_CUSTOM_HEADERS', 'Authorization: Bearer ambient-header');
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const model = createOpenAICompatibleChatModel(
      provider({ headers: {} }),
      'gpt-5.4',
    ) as BaseChatModel;
    for await (const _chunk of await model.stream('hello')) {
      // The request itself is the assertion; consume the stream to complete it.
    }

    expect(requestParts(fetchMock).headers.get('authorization')).toBeNull();
  });

  it('creates an embeddings adapter with the same base URL and authoritative headers', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'ambient-api-key');
    vi.stubEnv(
      'OPENAI_CUSTOM_HEADERS',
      'Authorization: Bearer ambient-header\nX-Ambient: ambient-value',
    );
    const encodedEmbedding = Buffer.alloc(8);
    encodedEmbedding.writeFloatLE(0.1, 0);
    encodedEmbedding.writeFloatLE(0.2, 4);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: encodedEmbedding.toString('base64') }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const embeddings = createOpenAICompatibleEmbeddingModel(
      provider({ headers: { 'X-API-Key': encrypt('embedding-key') } }),
      'embedding-model',
    );

    const result = await embeddings.embedQuery('hello\nworld');
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);

    const { url, init, headers, body } = requestParts(fetchMock);
    expect(url).toBe('https://example.com/v1/embeddings');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(headers.get('x-api-key')).toBe('embedding-key');
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-ambient')).toBeNull();
    expect(body).toEqual({
      model: 'embedding-model',
      input: 'hello world',
      encoding_format: 'base64',
    });
  });
});
