import { test, expect } from '../fixtures/api';

test.describe('GET /api/tts', () => {
  test('returns the full voice list with the expected structure', async ({
    request,
  }) => {
    const res = await request.get('/api/tts');
    expect(res.status()).toBe(200);
    const body = await res.json();

    // Value-level assertions on the voice catalog — not just shape.
    expect(body.defaultVoice).toBe('af_heart');
    expect(Array.isArray(body.voices)).toBe(true);
    // The Kokoro-82M v1.0 voicepack has exactly 28 voices.
    expect(body.voices).toHaveLength(28);

    // Spot-check a few known voices at specific positions.
    expect(body.voices[0]).toEqual({
      id: 'af_heart',
      name: 'Heart',
      language: 'en-us',
      gender: 'Female',
    });
    expect(body.voices[1].id).toBe('af_bella');
    expect(body.voices[13].id).toBe('am_michael');
    // Last voice is en-gb male.
    expect(body.voices[27]).toEqual({
      id: 'bm_lewis',
      name: 'Lewis',
      language: 'en-gb',
      gender: 'Male',
    });

    // defaultVoice must be a member of the voices list.
    const voiceIds: string[] = body.voices.map((v: { id: string }) => v.id);
    expect(voiceIds).toContain(body.defaultVoice);

    // Every voice must have the required fields with non-empty strings.
    for (const voice of body.voices) {
      expect(typeof voice.id).toBe('string');
      expect(voice.id.length).toBeGreaterThan(0);
      expect(typeof voice.name).toBe('string');
      expect(voice.name.length).toBeGreaterThan(0);
      expect(typeof voice.language).toBe('string');
      expect(voice.language.length).toBeGreaterThan(0);
      expect(typeof voice.gender).toBe('string');
      expect(['Male', 'Female']).toContain(voice.gender);
    }
  });
});

test.describe('POST /api/tts', () => {
  test('rejects empty body', async ({ request }) => {
    const res = await request.post('/api/tts', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'No text provided to synthesize.' });
  });

  test('rejects whitespace-only text', async ({ request }) => {
    const res = await request.post('/api/tts', {
      data: { text: '   ' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'No text provided to synthesize.' });
  });

  test('rejects whitespace-only markdown', async ({ request }) => {
    // markdown takes priority over text; whitespace-only must still be rejected.
    const res = await request.post('/api/tts', {
      data: { markdown: '\n\n ', text: 'legacy fallback' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'No text provided to synthesize.' });
  });

  test('returns a prep id for valid plain text', async ({ request }) => {
    const res = await request.post('/api/tts', {
      data: { text: 'Hello, world.' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // The prep cache returns a UUID for the stashed segments.
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    // UUID v4 format.
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('returns a prep id for valid markdown', async ({ request }) => {
    // markdown takes priority over text when both are present.
    const res = await request.post('/api/tts', {
      data: {
        markdown: '**Bold** and *italic* text.',
        text: 'should be ignored',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.id).toBe('string');
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('falls back to default voice when an unknown voice is requested', async ({
    request,
  }) => {
    // An invalid voice id is silently replaced with DEFAULT_VOICE — the request
    // still succeeds because speechify is voice-independent (voice is only used
    // at synthesis time in GET /stream).
    const res = await request.post('/api/tts', {
      data: { text: 'Valid text.', voice: 'nonexistent_voice_xyz' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.id).toBe('string');
  });
});

test.describe('GET /api/tts/stream', () => {
  test('rejects missing id query param', async ({ request }) => {
    const res = await request.get('/api/tts/stream');
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ message: 'Missing id.' });
  });

  test('returns 404 for bogus id', async ({ request }) => {
    const res = await request.get('/api/tts/stream?id=nonexistent-bogus-id');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      message: 'Speech preparation expired or not found.',
    });
  });

  test('returns 404 for a well-formed but nonexistent UUID id', async ({
    request,
  }) => {
    const res = await request.get(
      '/api/tts/stream?id=00000000-0000-4000-8000-000000000000',
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      message: 'Speech preparation expired or not found.',
    });
  });
});
