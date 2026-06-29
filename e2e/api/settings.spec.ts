import { test, expect } from '../fixtures/api';

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
});
