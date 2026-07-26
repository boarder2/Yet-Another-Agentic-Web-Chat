import { test, expect } from '../fixtures';
import { SettingsPage } from '../pages/SettingsPage';
import { uniq } from '../utils/helpers';

test.describe('MCP extra headers', () => {
  test('adds a server with an extra header and never shows its value again', async ({
    page,
    request,
  }) => {
    const settings = new SettingsPage(page);
    const name = uniq('mcp-hdr');

    await settings.goto();
    await settings.openSection('MCP Servers');

    await page.getByRole('button', { name: 'Add MCP Server' }).click();
    await page.getByPlaceholder('My MCP Server').fill(name);
    await page
      .getByPlaceholder('https://example.com/mcp')
      .fill('https://example.com/mcp');

    await page.getByRole('button', { name: 'Add header' }).first().click();
    await page.getByLabel('Header 1 name').fill('X-Portainer-API-Key');
    await page.getByLabel('Header 1 value').fill('ptr_never_shown');

    await page.getByRole('button', { name: 'Add Server', exact: true }).click();
    // Wait for the form to close, otherwise the value is still sitting in its
    // (not yet unmounted) input when the leak assertion below runs.
    await expect(page.getByLabel('Header 1 value')).toBeHidden();

    // The API is the source of truth: the name is stored, the value is not
    // returned to the client under any field.
    await expect
      .poll(async () => {
        const servers = (await (await request.get('/api/mcp/servers')).json())
          .servers;
        return servers.find((s: { name: string }) => s.name === name) ?? null;
      })
      .not.toBeNull();

    const servers = (await (await request.get('/api/mcp/servers')).json())
      .servers;
    const created = servers.find((s: { name: string }) => s.name === name);
    expect(created.extraHeaderNames).toEqual(['X-Portainer-API-Key']);
    expect(JSON.stringify(created)).not.toContain('ptr_never_shown');

    // The value must not be rendered back into the page either.
    expect(await page.content()).not.toContain('ptr_never_shown');

    await request.delete(`/api/mcp/servers/${created.id}`);
  });

  test('editing one header leaves the others intact without re-entering them', async ({
    page,
    request,
  }) => {
    const name = uniq('mcp-merge');
    const created = (
      await (
        await request.post('/api/mcp/servers', {
          data: {
            name,
            url: 'https://example.com/mcp',
            extraHeaders: { 'X-Gate': 'gate-secret', 'X-Key': 'key-secret' },
          },
        })
      ).json()
    ).server;

    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.openSection('MCP Servers');

    // Other specs seed MCP servers into the shared test DB, so find this
    // server's own collapsed card by its unique name before expanding it.
    // (The edit form shows the name in an input value, not as text, so the
    // same `hasText` filter would not match once it is open.)
    await page
      .locator('div.border.border-surface-2.rounded-surface.p-4.bg-surface')
      .filter({ hasText: name })
      .getByRole('button', { name: 'Edit' })
      .click();

    // Only one row can be editing at a time, so these are unambiguous.
    // Both headers render with blank (write-only) values; change only the
    // second and save — the first must survive untouched.
    await page.getByLabel('Header 2 value').fill('key-secret-v2');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByLabel('Header 2 value')).toBeHidden();

    await expect
      .poll(async () => {
        const servers = (await (await request.get('/api/mcp/servers')).json())
          .servers;
        const s = servers.find((x: { id: string }) => x.id === created.id);
        return s ? [...s.extraHeaderNames].sort() : null;
      })
      .toEqual(['X-Gate', 'X-Key']);

    await request.delete(`/api/mcp/servers/${created.id}`);
  });
});
