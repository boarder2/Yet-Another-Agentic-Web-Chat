import { test, expect } from '../fixtures/api';

test.describe('GET /api/workspaces', () => {
  test('returns a workspaces array', async ({ request }) => {
    const res = await request.get('/api/workspaces');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.workspaces)).toBe(true);
  });
});

test.describe('POST /api/workspaces', () => {
  test('rejects missing name with 400', async ({ request }) => {
    const res = await request.post('/api/workspaces', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('creates a workspace and returns it', async ({ request }) => {
    const name = `test-ws-${Date.now()}`;
    const res = await request.post('/api/workspaces', { data: { name } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.workspace).toMatchObject({ name });
    expect(body.workspace.id).toBeTruthy();
  });
});
