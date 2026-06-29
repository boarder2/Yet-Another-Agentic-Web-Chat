import { test, expect } from '../fixtures/api';
import { seedSkill } from '../utils/seed';

test.describe('GET /api/skills', () => {
  test('returns an array', async ({ request }) => {
    const res = await request.get('/api/skills');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('a seeded skill appears in the list', async ({ request }) => {
    const id = await seedSkill(request, { name: 'unique-skill-list-test' });
    const res = await request.get('/api/skills');
    const body = await res.json();
    const found = (body as Record<string, unknown>[]).find((s) => s.id === id);
    expect(found).toBeTruthy();
    expect((found as Record<string, unknown>).name).toBe(
      'unique-skill-list-test',
    );
    expect((found as Record<string, unknown>).description).toBe(
      'Test skill unique-skill-list-test',
    );
    expect((found as Record<string, unknown>).content).toBe(
      '# unique-skill-list-test\n\nTest skill content.',
    );
    expect((found as Record<string, unknown>).enabled).toBe(true);
  });

  test('respects enabled query param', async ({ request }) => {
    const res = await request.get('/api/skills?enabled=true');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const s of body) {
      expect(s.enabled).toBe(true);
    }
  });
});

test.describe('POST /api/skills', () => {
  test('creates a skill and returns 201 with the object', async ({
    request,
  }) => {
    const name = `test-create-skill-${Date.now()}`;
    const res = await request.post('/api/skills', {
      data: {
        name,
        description: 'A test skill',
        content: '# Test\n\nSkill content.',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe(name);
    expect(body.description).toBe('A test skill');
    expect(body.content).toBe('# Test\n\nSkill content.');
    expect(body.enabled).toBe(true);
  });

  test('rejects missing required fields with 400', async ({ request }) => {
    const res = await request.post('/api/skills', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('name, description, and content are required');
  });

  test('rejects missing name with 400', async ({ request }) => {
    const res = await request.post('/api/skills', {
      data: { description: 'desc', content: 'content' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('name, description, and content are required');
  });
});

test.describe('GET /api/skills/[id]', () => {
  test('returns a skill by id', async ({ request }) => {
    const id = await seedSkill(request, {
      name: 'get-by-id-skill',
      description: 'Get by id desc',
      content: '# GetById\n\ncontent.',
    });
    const res = await request.get(`/api/skills/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.name).toBe('get-by-id-skill');
    expect(body.description).toBe('Get by id desc');
    expect(body.content).toBe('# GetById\n\ncontent.');
    expect(body.enabled).toBe(true);
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.get('/api/skills/nonexistent-id');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

test.describe('PUT /api/skills/[id]', () => {
  test('updates a skill description and returns it', async ({ request }) => {
    const id = await seedSkill(request, {
      name: 'put-update-desc',
      description: 'before update',
      content: '# Before\n\ncontent.',
    });
    const res = await request.put(`/api/skills/${id}`, {
      data: { description: 'updated description' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.name).toBe('put-update-desc');
    expect(body.description).toBe('updated description');
    expect(body.content).toBe('# Before\n\ncontent.');
    expect(body.enabled).toBe(true);
  });

  test('toggles enabled via PUT body', async ({ request }) => {
    const id = await seedSkill(request, {
      name: 'put-toggle-enabled',
      description: 'Toggle test',
      content: '# Toggle\n\ncontent.',
    });
    const res = await request.put(`/api/skills/${id}`, {
      data: { enabled: false },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.enabled).toBe(false);
    expect(body.name).toBe('put-toggle-enabled');
    expect(body.description).toBe('Toggle test');
    expect(body.content).toBe('# Toggle\n\ncontent.');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.put('/api/skills/nonexistent-id', {
      data: { description: 'updated' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

test.describe('DELETE /api/skills/[id]', () => {
  test('deletes a skill and returns success', async ({ request }) => {
    const id = await seedSkill(request);
    const res = await request.delete(`/api/skills/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.delete('/api/skills/nonexistent-id');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  test('delete then GET returns 404', async ({ request }) => {
    const id = await seedSkill(request);
    await request.delete(`/api/skills/${id}`);
    const res = await request.get(`/api/skills/${id}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});
