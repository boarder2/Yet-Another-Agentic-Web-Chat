import { test, expect } from '../fixtures/api';
import { MASKED_SECRET } from '../../src/lib/maskedSecret';

// POST /api/config only writes encrypted credentials now (setCredential) and
// invalidates the shared model-provider cache — concurrent writes to the same
// key, or a cache invalidation racing another test's read, could interfere
// across tests. This spec lives in the `serial` project (one worker, not
// fully parallel), so that can't happen.

test.describe('GET /api/config', () => {
  test('returns 200 with an object body', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  test('includes chatModelProviders with the test provider and models', async ({
    request,
  }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('chatModelProviders');
    expect(typeof body.chatModelProviders).toBe('object');

    const c = body.chatModelProviders;
    expect(c).toHaveProperty('test');
    expect(Array.isArray(c.test)).toBe(true);

    const names = c.test.map((m: { name: string }) => m.name);
    expect(names).toContain('test-direct');
    expect(names).toContain('test-tool');

    for (const m of c.test) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.displayName).toBe('string');
    }
  });

  test('includes embeddingModelProviders object', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('embeddingModelProviders');
    expect(typeof body.embeddingModelProviders).toBe('object');
  });

  test('masks a configured api key with the sentinel', async ({ request }) => {
    const fakeKey = 'sk-test-fake-key-masking-check';
    await request.post('/api/config', { data: { openaiApiKey: fakeKey } });
    try {
      const res = await request.get('/api/config');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.openaiApiKey).toBe(MASKED_SECRET);
    } finally {
      // Restore: clear the key so config.toml is left as it was
      await request.post('/api/config', { data: { openaiApiKey: '' } });
    }
  });

  test('clearing an api key makes it falsy in GET', async ({ request }) => {
    // Create BOTH branches deterministically: set → sentinel, clear → falsy.
    const key = 'aimlApiKey';
    const knownValue = 'sk-test-aiml-branch-check';

    // Set the key
    await request.post('/api/config', { data: { [key]: knownValue } });

    try {
      // Branch 1: key is set → GET returns the masked sentinel
      const res1 = await request.get('/api/config');
      expect(res1.status()).toBe(200);
      expect((await res1.json())[key]).toBe(MASKED_SECRET);

      // Branch 2: clear the key → GET returns falsy
      await request.post('/api/config', { data: { [key]: '' } });

      const res2 = await request.get('/api/config');
      expect(res2.status()).toBe(200);
      const cleared = (await res2.json())[key];
      expect(!cleared).toBe(true);
    } finally {
      // Restore so parallel tests are not affected
      await request.post('/api/config', { data: { [key]: knownValue } });
    }
  });

  test('codeExecution is an object with boolean enabled', async ({
    request,
  }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('codeExecution');
    expect(typeof body.codeExecution).toBe('object');
    expect(body.codeExecution).not.toBeNull();
    expect(typeof body.codeExecution.enabled).toBe('boolean');
  });

  test('includes searchCapabilities sections', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('searchCapabilitiesRegular');
    expect(typeof body.searchCapabilitiesRegular).toBe('object');
    expect(body.searchCapabilitiesRegular).not.toBeNull();

    expect(body).toHaveProperty('searchCapabilitiesPrivate');
    expect(typeof body.searchCapabilitiesPrivate).toBe('object');
    expect(body.searchCapabilitiesPrivate).not.toBeNull();
  });

  test('includes non-sensitive infrastructure fields', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();

    // Always present with a string (possibly empty). Provider/search endpoint
    // URLs (lmStudioApiUrl, searxngApiUrl, ...) are DB-backed settings now — see
    // settings.spec.ts — not part of this route.
    expect(typeof body.baseUrl).toBe('string');
  });

  test('does not include fields moved to /api/settings', async ({
    request,
  }) => {
    const res = await request.get('/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).not.toHaveProperty('lmStudioApiUrl');
    expect(body).not.toHaveProperty('customOpenaiApiUrl');
    expect(body).not.toHaveProperty('customOpenaiModelName');
    expect(body).not.toHaveProperty('searxngApiUrl');
    expect(body).not.toHaveProperty('privateSessionDurationMinutes');
  });
});

test.describe('POST /api/config', () => {
  test('returns 200 with success message', async ({ request }) => {
    const res = await request.post('/api/config', { data: {} });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Config updated');
  });

  test('masked sentinel in POST preserves the existing key', async ({
    request,
  }) => {
    const fakeKey = 'sk-test-preserve-check';
    // Set a key
    await request.post('/api/config', { data: { groqApiKey: fakeKey } });

    try {
      // POST the sentinel — must NOT clear the key
      await request.post('/api/config', {
        data: { groqApiKey: MASKED_SECRET },
      });

      const res = await request.get('/api/config');
      expect(res.status()).toBe(200);
      const body = await res.json();
      // Key still set → must still be masked
      expect(body.groqApiKey).toBe(MASKED_SECRET);
    } finally {
      await request.post('/api/config', { data: { groqApiKey: '' } });
    }
  });

  test('masked sentinel preserves a search key', async ({ request }) => {
    const fakeKey = 'sk-brave-search-test-key';
    await request.post('/api/config', {
      data: { braveSearchApiKey: fakeKey },
    });

    try {
      // POST the sentinel — must NOT clear the key
      await request.post('/api/config', {
        data: { braveSearchApiKey: MASKED_SECRET },
      });

      const res = await request.get('/api/config');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.braveSearchApiKey).toBe(MASKED_SECRET);
    } finally {
      await request.post('/api/config', {
        data: { braveSearchApiKey: '' },
      });
    }
  });
});

test.describe('GET /api/models', () => {
  test('returns providers structure', async ({ request }) => {
    const res = await request.get('/api/models');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('chatModelProviders');
    expect(body).toHaveProperty('embeddingModelProviders');
  });

  test('chatModelProviders includes test with expected display names', async ({
    request,
  }) => {
    const res = await request.get('/api/models');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.chatModelProviders).toHaveProperty('test');
    const testChat = body.chatModelProviders.test;

    expect(testChat).toHaveProperty('test-direct');
    expect(testChat['test-direct'].displayName).toBe('Test (direct)');

    expect(testChat).toHaveProperty('test-tool');
    expect(testChat['test-tool'].displayName).toBe('Test (tool loop)');
  });

  test('embeddingModelProviders includes test with test-embed', async ({
    request,
  }) => {
    const res = await request.get('/api/models');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.embeddingModelProviders).toHaveProperty('test');
    const testEmbed = body.embeddingModelProviders.test;

    expect(testEmbed).toHaveProperty('test-embed');
    expect(testEmbed['test-embed'].displayName).toBe('Test Embeddings');
  });
});
