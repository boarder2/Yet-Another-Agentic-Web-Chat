import { test, expect } from '../fixtures';
import { test as apiTest } from '../fixtures/api';

// Runs against the dedicated ENCRYPTION_PASSPHRASE-less webServer configured
// in playwright.config.ts (project: encryption-gate) — the only place this
// state can be exercised, since every other project's server always has a
// passphrase set.

test.describe('encryption gate: UI', () => {
  test('home page shows the blocking error instead of the app', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    await expect(
      page.getByRole('heading', { name: 'Encryption not configured' }),
    ).toBeVisible();
    await expect(page.getByText(/ENCRYPTION_PASSPHRASE/).first()).toBeVisible();

    // The normal app chrome must not render at all.
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0);
  });
});

apiTest.describe('encryption gate: API', () => {
  apiTest(
    'GET /api/config reports encryptionConfigured: false',
    async ({ request }) => {
      const res = await request.get('/api/config');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.encryptionConfigured).toBe(false);
      // The passphrase itself must never be sent to the client, under any key.
      expect(JSON.stringify(body)).not.toContain('PASSPHRASE');
    },
  );

  apiTest(
    'POST /api/config refuses to save a credential with 503',
    async ({ request }) => {
      const res = await request.post('/api/config', {
        data: { openaiApiKey: 'sk-should-not-be-saved' },
      });
      expect(res.status()).toBe(503);
      const body = await res.json();
      expect(body.message).toContain('ENCRYPTION_PASSPHRASE');
    },
  );

  apiTest(
    'POST /api/config still accepts a non-credential field',
    async ({ request }) => {
      const res = await request.post('/api/config', {
        data: { privateSessionDurationMinutes: 60 },
      });
      expect(res.status()).toBe(200);
    },
  );

  apiTest(
    'POST /api/mcp/servers refuses a secretToken with 503',
    async ({ request }) => {
      const res = await request.post('/api/mcp/servers', {
        data: {
          name: `gate-test-${Date.now()}`,
          url: 'http://localhost:9999/mcp',
          authType: 'bearer',
          secretToken: 'should-not-be-saved',
        },
      });
      expect(res.status()).toBe(503);
      const body = await res.json();
      expect(body.error).toContain('ENCRYPTION_PASSPHRASE');
    },
  );

  apiTest(
    'POST /api/mcp/servers still accepts a server without secrets',
    async ({ request }) => {
      const name = `gate-test-nosecret-${Date.now()}`;
      const res = await request.post('/api/mcp/servers', {
        data: {
          name,
          url: 'http://localhost:9999/mcp',
          authType: 'none',
        },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      await request.delete(`/api/mcp/servers/${body.server.id}`);
    },
  );
});
