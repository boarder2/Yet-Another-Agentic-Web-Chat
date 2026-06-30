import { test, expect } from '../fixtures/api';
import { seedSystemPrompt } from '../utils/seed';

test.describe('GET /api/system-prompts', () => {
  test('returns an array of prompts with expected fields', async ({
    request,
  }) => {
    const res = await request.get('/api/system-prompts');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    const names = body.map((p: { name: string }) => p.name);
    expect(names).toContain('Web Searches');
    expect(names).toContain('Local Documents');
    expect(names).toContain('Chat Conversations');
    expect(names).toContain('Scholarly Articles');
    expect(names).toContain('Comparative Analysis');
    expect(names).toContain('Deep Dive / Literature Review');
    expect(names).toContain('Fact-Check / Verification');

    for (const item of body) {
      expect(typeof item.name).toBe('string');
      expect(item.name.length).toBeGreaterThan(0);
      expect(typeof item.content).toBe('string');
      expect(item.content.length).toBeGreaterThan(0);
      expect(['persona', 'methodology']).toContain(item.type);
    }
  });

  test('returns seeded custom prompt in the list', async ({ request }) => {
    const name = `sp-list-${Date.now()}`;
    const id = await seedSystemPrompt(request, {
      name,
      content: 'Test content',
      type: 'persona',
    });
    const res = await request.get('/api/system-prompts');
    const body = await res.json();
    const found = body.find((p: { id: string }) => p.id === id);
    expect(found).toBeTruthy();
    expect(found.name).toBe(name);
    expect(found.content).toBe('Test content');
    expect(found.type).toBe('persona');
    expect(found.readOnly).toBe(false);
  });

  test('filters by type=persona', async ({ request }) => {
    const res = await request.get('/api/system-prompts?type=persona');
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const item of body) {
      expect(item.type).toBe('persona');
    }
    const names = body.map((p: { name: string }) => p.name);
    expect(names).toContain('Web Searches');
    expect(names).toContain('Local Documents');
    expect(names).toContain('Chat Conversations');
    expect(names).toContain('Scholarly Articles');
    // Methodology builtins should not leak into a persona filter
    expect(names).not.toContain('Comparative Analysis');
    expect(names).not.toContain('Deep Dive / Literature Review');
    expect(names).not.toContain('Fact-Check / Verification');
  });

  test('filters by type=methodology', async ({ request }) => {
    const res = await request.get('/api/system-prompts?type=methodology');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // All returned prompts should be methodology type
    for (const item of body) {
      expect(item.type).toBe('methodology');
    }
    const names = body.map((p: { name: string }) => p.name);
    expect(names).toContain('Comparative Analysis');
    expect(names).toContain('Deep Dive / Literature Review');
    expect(names).toContain('Fact-Check / Verification');
    // Persona builtins should not leak into a methodology filter
    expect(names).not.toContain('Web Searches');
    expect(names).not.toContain('Chat Conversations');
  });

  test('type=methodology includes seeded methodology prompt', async ({
    request,
  }) => {
    const name = `sp-method-${Date.now()}`;
    const id = await seedSystemPrompt(request, {
      name,
      content: 'Methodology test',
      type: 'methodology',
    });
    const res = await request.get('/api/system-prompts?type=methodology');
    const body = await res.json();
    const found = body.find((p: { id: string }) => p.id === id);
    expect(found).toBeTruthy();
    expect(found.type).toBe('methodology');
    expect(found.readOnly).toBe(false);
  });
});

test.describe('POST /api/system-prompts', () => {
  test('creates a prompt and returns it with 201', async ({ request }) => {
    const name = `sp-create-${Date.now()}`;
    const res = await request.post('/api/system-prompts', {
      data: { name, content: 'Hello world', type: 'persona' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe(name);
    expect(body.content).toBe('Hello world');
    expect(body.type).toBe('persona');
    expect(body).toHaveProperty('createdAt');
    expect(body).toHaveProperty('updatedAt');
  });

  test('rejects missing name with 400', async ({ request }) => {
    const res = await request.post('/api/system-prompts', {
      data: { content: 'Missing name' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Name and content are required');
  });

  test('rejects missing content with 400', async ({ request }) => {
    const res = await request.post('/api/system-prompts', {
      data: { name: 'Missing content' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Name and content are required');
  });

  test('defaults type to persona when omitted or invalid', async ({
    request,
  }) => {
    const name = `sp-default-type-${Date.now()}`;
    const res = await request.post('/api/system-prompts', {
      data: { name, content: 'No type provided' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.type).toBe('persona');
  });

  test('creates a methodology prompt when type=methodology', async ({
    request,
  }) => {
    const name = `sp-create-method-${Date.now()}`;
    const res = await request.post('/api/system-prompts', {
      data: { name, content: 'Method content', type: 'methodology' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe(name);
    expect(body.type).toBe('methodology');
  });
});

test.describe('PUT /api/system-prompts/[id]', () => {
  test('updates a prompt and returns it', async ({ request }) => {
    const id = await seedSystemPrompt(request, {
      name: 'before-update',
      content: 'Before',
    });
    const res = await request.put(`/api/system-prompts/${id}`, {
      data: { name: 'after-update', content: 'After' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.name).toBe('after-update');
    expect(body.content).toBe('After');
    expect(body.type).toBe('persona');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.put('/api/system-prompts/nonexistent-id', {
      data: { name: 'x', content: 'x' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Prompt not found');
  });

  test('rejects missing fields with 400', async ({ request }) => {
    const id = await seedSystemPrompt(request);
    const res = await request.put(`/api/system-prompts/${id}`, { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Name and content are required');
  });

  test('changes type from persona to methodology', async ({ request }) => {
    const id = await seedSystemPrompt(request, {
      name: 'type-change-test',
      content: 'Before',
      type: 'persona',
    });
    const res = await request.put(`/api/system-prompts/${id}`, {
      data: {
        name: 'type-change-test',
        content: 'After',
        type: 'methodology',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.type).toBe('methodology');
    expect(body.content).toBe('After');
  });
});

test.describe('DELETE /api/system-prompts/[id]', () => {
  test('deletes a prompt and returns success message', async ({ request }) => {
    const id = await seedSystemPrompt(request);
    const res = await request.delete(`/api/system-prompts/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Prompt deleted successfully');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.delete('/api/system-prompts/nonexistent-id');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Prompt not found');
  });

  test('deleted prompt does not appear in list', async ({ request }) => {
    const id = await seedSystemPrompt(request, {
      name: `sp-gone-${Date.now()}`,
      content: 'Will delete',
    });
    await request.delete(`/api/system-prompts/${id}`);
    const res = await request.get('/api/system-prompts');
    const body = await res.json();
    expect(body.find((p: { id: string }) => p.id === id)).toBeUndefined();
  });

  test('deleted prompt returns 404 on subsequent GET (no direct GET route)', async ({
    request,
  }) => {
    const id = await seedSystemPrompt(request);
    await request.delete(`/api/system-prompts/${id}`);
    // There's no GET /api/system-prompts/[id] route — verify it's gone from list
    const res = await request.get('/api/system-prompts');
    const body = await res.json();
    expect(body.find((p: { id: string }) => p.id === id)).toBeUndefined();
  });
});
