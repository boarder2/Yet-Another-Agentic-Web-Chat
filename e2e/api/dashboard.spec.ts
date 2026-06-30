import { test, expect } from '../fixtures/api';

test.describe('POST /api/dashboard/process-widget', () => {
  test('rejects missing required fields', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-widget', {
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Missing required fields: prompt, provider, model',
    });
  });

  test('rejects when only prompt is provided', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-widget', {
      data: { prompt: 'hello' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Missing required fields: prompt, provider, model',
    });
  });

  test('processes a prompt with the mocked test model', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-widget', {
      data: {
        prompt: 'Summarize: hello',
        provider: 'test',
        model: 'test-direct',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sourcesFetched).toBe(0);
    expect(body.totalSources).toBe(0);
    expect(body.content).toBe('This is a deterministic test answer.');
  });

  test('processes prompt with theme (mocked model)', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-widget', {
      data: {
        prompt: 'Summarize: hello',
        provider: 'test',
        model: 'test-direct',
        theme: {
          mode: 'dark' as const,
          colors: {
            background: 'rgb(28,28,28)',
            foreground: 'rgb(242,242,242)',
            surface: 'rgb(38,38,38)',
            surface2: 'rgb(48,48,48)',
            border: 'rgb(48,48,48)',
            accent: 'rgb(37,99,235)',
            accentForeground: 'rgb(252,252,252)',
            danger: 'rgb(239,68,68)',
            success: 'rgb(34,197,94)',
            warning: 'rgb(234,179,8)',
            info: 'rgb(59,130,246)',
          },
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.content).toBe('This is a deterministic test answer.');
  });

  test('returns 500 when all sources fail to fetch', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-widget', {
      data: {
        prompt: 'Analyze sources',
        provider: 'test',
        model: 'test-direct',
        sources: [{ url: 'http://127.0.0.1:1/nonexistent', type: 'HTTP Data' }],
      },
    });
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch content from all sources');
  });
});

test.describe('POST /api/dashboard/process-code-widget', () => {
  test('rejects missing code field', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-code-widget', {
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Missing required field: code' });
  });

  test('rejects code over 50000 characters', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-code-widget', {
      data: { code: 'x'.repeat(50001) },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Code exceeds 50000 characters.' });
  });

  test('rejects too many sources', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-code-widget', {
      data: {
        code: 'return 1;',
        sources: Array.from({ length: 9 }, (_, i) => ({
          url: `http://example.com/${i}`,
          type: 'HTTP Data' as const,
        })),
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'At most 8 sources allowed.' });
  });

  test('accepts exactly at the source limit', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-code-widget', {
      data: {
        code: 'return 1;',
        sources: Array.from({ length: 8 }, (_, i) => ({
          url: `http://example.com/${i}`,
          type: 'HTTP Data' as const,
        })),
      },
    });
    // 8 is allowed; the code runner may fail (no Docker in tests) but that's an
    // infra concern — the validation should pass.
    expect(res.status()).not.toBe(400);
  });

  test('rejects non-string code', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-code-widget', {
      data: { code: 123 },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Missing required field: code' });
  });

  test('null sources passes validation (not array)', async ({ request }) => {
    const res = await request.post('/api/dashboard/process-code-widget', {
      data: { code: 'return 1;', sources: null },
    });
    // Null is not an array, so the source-count check is skipped.
    // Validation passes; the runner may fail (no Docker) but it's not a 400.
    expect(res.status()).not.toBe(400);
  });
});
