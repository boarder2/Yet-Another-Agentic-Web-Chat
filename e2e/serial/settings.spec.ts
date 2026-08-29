import { test, expect } from '../fixtures/api';

// Settings live in one global app_settings row per key, so tests that mutate
// the same key (e.g. ttsSpeed in both the single-key and batch cases) — or
// other specs in this `serial` project touching the same shared
// app_settings rows (settings-persistence, memory, dashboard, agent-panel,
// chat/model-picker) — must not run concurrently. The project's single
// worker guarantees that.

test.describe('GET /api/settings', () => {
  test('returns a settings object with expected shape', async ({ request }) => {
    const res = await request.get('/api/settings');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    expect(Array.isArray(body)).toBe(false);

    // All values must be strings (flat key→string map)
    for (const value of Object.values(body)) {
      expect(typeof value).toBe('string');
    }

    // Seeded test-mode model settings
    expect(body.chatModelProvider).toBe('test');
    expect(body.chatModel).toBe('test-direct');
    expect(body.systemModelProvider).toBe('test');
    expect(body.systemModel).toBe('test-direct');
    expect(body.memoryModelProvider).toBe('test');
    expect(body.memoryModel).toBe('test-direct');
    expect(body.embeddingModelProvider).toBe('test');
    expect(body.embeddingModel).toBe('test-embed');
  });
});

test.describe('PATCH /api/settings', () => {
  test('round-trip: write, read back, then restore', async ({ request }) => {
    const key = 'ttsSpeed';
    // Read current value
    const before = await request.get('/api/settings');
    const beforeBody = await before.json();
    const original = beforeBody[key]; // undefined if not set

    // Write a test value
    const patchRes = await request.patch('/api/settings', {
      data: { [key]: '0.75' },
    });
    expect(patchRes.status()).toBe(204);

    // Read back and assert it changed
    const after = await request.get('/api/settings');
    const afterBody = await after.json();
    expect(afterBody[key]).toBe('0.75');

    // Restore original value (or delete if was unset)
    const restoreRes = await request.patch('/api/settings', {
      data: { [key]: original ?? null },
    });
    expect(restoreRes.status()).toBe(204);

    // Verify restored
    const restored = await request.get('/api/settings');
    const restoredBody = await restored.json();
    expect(restoredBody[key]).toBe(original);
  });

  test('canonicalizes quantization values and deletes the default', async ({
    request,
  }) => {
    const key = 'openrouterQuantizations';
    const before = await (await request.get('/api/settings')).json();
    const original = before[key];

    try {
      const updateRes = await request.patch('/api/settings', {
        data: { [key]: '["fp8","int4","bf16"]' },
      });
      expect(updateRes.status()).toBe(204);

      const updated = await (await request.get('/api/settings')).json();
      expect(updated[key]).toBe('["int4","fp8","bf16"]');

      const emptyRes = await request.patch('/api/settings', {
        data: { [key]: '[]' },
      });
      expect(emptyRes.status()).toBe(204);

      const defaulted = await (await request.get('/api/settings')).json();
      expect(defaulted[key]).toBeUndefined();
    } finally {
      const restoreRes = await request.patch('/api/settings', {
        data: { [key]: original ?? null },
      });
      expect(restoreRes.status()).toBe(204);
    }
  });

  test('rejects invalid quantization values without a partial batch write', async ({
    request,
  }) => {
    const key = 'openrouterQuantizations';
    const unrelatedKey = 'ttsSpeed';
    const before = await (await request.get('/api/settings')).json();
    const original = before[key];
    const originalUnrelated = before[unrelatedKey];

    try {
      const baselineRes = await request.patch('/api/settings', {
        data: { [key]: '["fp8"]' },
      });
      expect(baselineRes.status()).toBe(204);

      const invalidValues: Array<[string, unknown]> = [
        ['malformed JSON', '["fp8"'],
        ['non-array JSON', '"fp8"'],
        ['duplicate value', '["fp8","fp8"]'],
        ['unsupported value', '["int3"]'],
        ['wrongly typed value', ['fp8']],
      ];

      for (const [label, value] of invalidValues) {
        const res = await request.patch('/api/settings', {
          data: {
            [key]: value,
            [unrelatedKey]: 'must-not-be-written',
          },
        });
        expect(res.status(), label).toBe(400);

        const afterRejected = await (await request.get('/api/settings')).json();
        expect(afterRejected[key], label).toBe('["fp8"]');
        expect(afterRejected[unrelatedKey], label).toBe(originalUnrelated);
      }
    } finally {
      const restoreRes = await request.patch('/api/settings', {
        data: {
          [key]: original ?? null,
          [unrelatedKey]: originalUnrelated ?? null,
        },
      });
      expect(restoreRes.status()).toBe(204);
    }
  });

  test('rejects non-object body with 400', async ({ request }) => {
    const res = await request.patch('/api/settings', {
      data: ['not', 'an', 'object'],
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Body must be an object of { key: string | null }');
  });

  test('rejects non-string value with 400', async ({ request }) => {
    const res = await request.patch('/api/settings', {
      data: { chatModelProvider: 123 },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      'Value for "chatModelProvider" must be a string or null',
    );
  });

  test('ignores unknown keys (204, key does not appear)', async ({
    request,
  }) => {
    const unknownKey = 'nonexistent_setting_key_xyz';
    const res = await request.patch('/api/settings', {
      data: { [unknownKey]: 'should-be-ignored' },
    });
    expect(res.status()).toBe(204);
    const getRes = await request.get('/api/settings');
    const body = await getRes.json();
    expect(body).not.toHaveProperty(unknownKey);
  });

  test('accepts null to delete a known key, then restores it', async ({
    request,
  }) => {
    // Distinct key from the round-trip test so the two can't race under
    // fullyParallel local workers.
    const key = 'ttsVoice';
    // Ensure the key exists first
    await request.patch('/api/settings', { data: { [key]: '0.5' } });
    // Delete it
    const delRes = await request.patch('/api/settings', {
      data: { [key]: null },
    });
    expect(delRes.status()).toBe(204);
    // Verify gone
    const getRes = await request.get('/api/settings');
    const body = await getRes.json();
    expect(body[key]).toBeUndefined();
    // Restore
    await request.patch('/api/settings', { data: { [key]: '0.5' } });
  });

  test('provider/search endpoint URLs round-trip (moved off /api/config)', async ({
    request,
  }) => {
    const key = 'lmStudioApiUrl';
    const before = await (await request.get('/api/settings')).json();
    const original = before[key];

    const patchRes = await request.patch('/api/settings', {
      data: { [key]: 'http://lmstudio.test:1234' },
    });
    expect(patchRes.status()).toBe(204);

    const after = await (await request.get('/api/settings')).json();
    expect(after[key]).toBe('http://lmstudio.test:1234');

    // Confirm /api/config no longer carries this field at all.
    const config = await (await request.get('/api/config')).json();
    expect(config).not.toHaveProperty(key);

    await request.patch('/api/settings', {
      data: { [key]: original ?? null },
    });
  });

  test('private session duration round-trips (moved off /api/config)', async ({
    request,
  }) => {
    const key = 'privateSessionDurationMinutes';
    const before = await (await request.get('/api/settings')).json();
    const original = before[key];

    const patchRes = await request.patch('/api/settings', {
      data: { [key]: '60' },
    });
    expect(patchRes.status()).toBe(204);

    const after = await (await request.get('/api/settings')).json();
    expect(after[key]).toBe('60');

    // Confirm /api/config no longer carries this field at all.
    const config = await (await request.get('/api/config')).json();
    expect(config).not.toHaveProperty(key);

    await request.patch('/api/settings', {
      data: { [key]: original ?? null },
    });
  });

  test('batch-updates multiple keys in one request', async ({ request }) => {
    const key1 = 'ttsSpeed';
    const key2 = 'ttsVoice';
    const orig = await (await request.get('/api/settings')).json();

    const patchRes = await request.patch('/api/settings', {
      data: { [key1]: '0.25', [key2]: '0.75' },
    });
    expect(patchRes.status()).toBe(204);

    const after = await (await request.get('/api/settings')).json();
    expect(after[key1]).toBe('0.25');
    expect(after[key2]).toBe('0.75');

    // Restore
    await request.patch('/api/settings', {
      data: {
        [key1]: orig[key1] ?? null,
        [key2]: orig[key2] ?? null,
      },
    });
  });
});
