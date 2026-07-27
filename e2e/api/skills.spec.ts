import { test, expect } from '../fixtures/api';
import { seedSkill, seedWorkspace } from '../utils/seed';

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

  test('enabled=true excludes disabled skills', async ({ request }) => {
    // Seed an enabled skill and a disabled skill
    const enabledId = await seedSkill(request, {
      name: 'enabled-filter-test',
    });
    const disabledId = await seedSkill(request, {
      name: 'disabled-filter-test',
    });
    await request.put(`/api/skills/${disabledId}`, {
      data: { enabled: false },
    });

    const res = await request.get('/api/skills?enabled=true');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ids: string[] = (body as Record<string, unknown>[]).map(
      (s) => s.id as string,
    );
    expect(ids).toContain(enabledId);
    expect(ids).not.toContain(disabledId);
    // All returned skills should be enabled
    for (const s of body) {
      expect(s.enabled).toBe(true);
    }
  });

  test('filters by workspaceId', async ({ request }) => {
    const wsA = await seedWorkspace(request, { name: 'skill-ws-a' });
    const wsB = await seedWorkspace(request, { name: 'skill-ws-b' });

    // Create a skill scoped to wsA
    const rA = await request.post('/api/skills', {
      data: {
        name: `ws-a-skill-${Date.now()}`,
        description: 'WS A scoped',
        content: '# A\n\nScoped to A.',
        workspaceId: wsA,
      },
    });
    expect(rA.status()).toBe(201);
    const skillA = await rA.json();

    // Create a skill scoped to wsB
    const rB = await request.post('/api/skills', {
      data: {
        name: `ws-b-skill-${Date.now()}`,
        description: 'WS B scoped',
        content: '# B\n\nScoped to B.',
        workspaceId: wsB,
      },
    });
    expect(rB.status()).toBe(201);
    const skillB = await rB.json();

    // Bare GET returns ALL skills (management view), including workspace-scoped ones
    const all = await request.get('/api/skills');
    const allIds = (await all.json()).map((s: { id: string }) => s.id);
    expect(allIds).toContain(skillA.id);
    expect(allIds).toContain(skillB.id);

    // ?workspaceId=wsA includes global + wsA-scoped, excludes wsB-scoped
    const resA = await request.get(
      `/api/skills?workspaceId=${encodeURIComponent(wsA)}`,
    );
    const idsA = (await resA.json()).map((s: { id: string }) => s.id);
    expect(idsA).toContain(skillA.id);
    expect(idsA).not.toContain(skillB.id);

    // ?workspaceId=wsB includes global + wsB-scoped, excludes wsA-scoped
    const resB = await request.get(
      `/api/skills?workspaceId=${encodeURIComponent(wsB)}`,
    );
    const idsB = (await resB.json()).map((s: { id: string }) => s.id);
    expect(idsB).toContain(skillB.id);
    expect(idsB).not.toContain(skillA.id);
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

  test('rejects duplicate name in global scope with 409', async ({
    request,
  }) => {
    const name = `dup-skill-${Date.now()}`;
    await seedSkill(request, { name });
    const res = await request.post('/api/skills', {
      data: { name, description: 'dup desc', content: '# Dup\n\nAgain.' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already exists');
  });

  test('allows a workspace skill to shadow a global name', async ({
    request,
  }) => {
    const name = `shadow-skill-${Date.now()}`;
    const ws = await seedWorkspace(request, { name: 'skill-shadow-ws' });
    await seedSkill(request, { name });

    // Workspace skills override same-named global ones at resolve time, so the
    // name being taken globally must not block the workspace-scoped override.
    const res = await request.post('/api/skills', {
      data: {
        name,
        description: 'Workspace override',
        content: '# Override',
        workspaceId: ws,
      },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).workspaceId).toBe(ws);
  });

  test('stores disableModelInvocation when provided', async ({ request }) => {
    const name = `dmi-skill-${Date.now()}`;
    const res = await request.post('/api/skills', {
      data: {
        name,
        description: 'DMI test',
        content: '# DMI\n\nTest.',
        disableModelInvocation: true,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.disableModelInvocation).toBe(true);
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

  test('applies every field of a combined patch', async ({ request }) => {
    const id = await seedSkill(request, { name: 'put-combined-patch' });
    const res = await request.put(`/api/skills/${id}`, {
      data: { enabled: false, content: '# After\n\npatched.' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.content).toBe('# After\n\npatched.');
  });

  test('moves a global skill into a workspace', async ({ request }) => {
    const ws = await seedWorkspace(request, { name: 'skill-move-target' });
    const id = await seedSkill(request, { name: `move-to-ws-${Date.now()}` });

    const res = await request.put(`/api/skills/${id}`, {
      data: { workspaceId: ws },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).workspaceId).toBe(ws);

    // It is now invisible to every other scope.
    const other = await seedWorkspace(request, { name: 'skill-move-other' });
    const resOther = await request.get(
      `/api/skills?workspaceId=${encodeURIComponent(other)}`,
    );
    const ids = (await resOther.json()).map((s: { id: string }) => s.id);
    expect(ids).not.toContain(id);
  });

  test('moves a workspace skill back to global', async ({ request }) => {
    const ws = await seedWorkspace(request, { name: 'skill-move-from' });
    const id = await seedSkill(request, {
      name: `move-to-global-${Date.now()}`,
      workspaceId: ws,
    });

    const res = await request.put(`/api/skills/${id}`, {
      data: { workspaceId: null },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).workspaceId).toBe(null);
  });

  test('moves a skill between workspaces', async ({ request }) => {
    const wsA = await seedWorkspace(request, { name: 'skill-move-a' });
    const wsB = await seedWorkspace(request, { name: 'skill-move-b' });
    const id = await seedSkill(request, {
      name: `move-a-to-b-${Date.now()}`,
      workspaceId: wsA,
    });

    const res = await request.put(`/api/skills/${id}`, {
      data: { workspaceId: wsB },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).workspaceId).toBe(wsB);
  });

  test('rejects a move that collides in the target scope with 409', async ({
    request,
  }) => {
    const name = `move-collision-${Date.now()}`;
    const ws = await seedWorkspace(request, { name: 'skill-collision-ws' });
    await seedSkill(request, { name });
    const wsSkillId = await seedSkill(request, { name, workspaceId: ws });

    const res = await request.put(`/api/skills/${wsSkillId}`, {
      data: { workspaceId: null },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('already exists');

    // The failed move left the skill where it was.
    const after = await request.get(`/api/skills/${wsSkillId}`);
    expect((await after.json()).workspaceId).toBe(ws);
  });

  test('renames a skill', async ({ request }) => {
    const id = await seedSkill(request, { name: 'put-rename-before' });
    const renamed = `put-rename-after-${Date.now()}`;
    const res = await request.put(`/api/skills/${id}`, {
      data: { name: renamed },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe(renamed);
  });

  test('renames and moves in one request', async ({ request }) => {
    const ws = await seedWorkspace(request, { name: 'skill-rename-move-ws' });
    const id = await seedSkill(request, { name: `rename-move-${Date.now()}` });
    const renamed = `renamed-and-moved-${Date.now()}`;

    const res = await request.put(`/api/skills/${id}`, {
      data: { name: renamed, workspaceId: ws },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe(renamed);
    expect(body.workspaceId).toBe(ws);
  });

  test('rejects a rename onto an existing name with 409', async ({
    request,
  }) => {
    const taken = `rename-taken-${Date.now()}`;
    await seedSkill(request, { name: taken });
    const id = await seedSkill(request, {
      name: `rename-source-${Date.now()}`,
    });

    const res = await request.put(`/api/skills/${id}`, {
      data: { name: taken },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('already exists');
  });

  test('rejects an invalid name with 400', async ({ request }) => {
    const id = await seedSkill(request, { name: 'put-invalid-rename' });
    const res = await request.put(`/api/skills/${id}`, {
      data: { name: 'Not A Valid Name' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('name must match');
  });

  test('rejects a rename onto a reserved system skill name with 409', async ({
    request,
  }) => {
    const id = await seedSkill(request, { name: `put-reserved-${Date.now()}` });
    const res = await request.put(`/api/skills/${id}`, {
      // A file-based system skill, so it is registered in every environment
      // (unlike code-execution, which is omitted when the tool is disabled).
      data: { name: 'deep-research' },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('reserved');
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
