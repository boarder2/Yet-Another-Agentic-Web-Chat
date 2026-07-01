import { test, expect } from '../fixtures';
import { SettingsPage } from '../pages/SettingsPage';

test.describe('settings depth', () => {
  test('persona prompt: create, edit, and delete round-trips through the API', async ({
    page,
    request,
  }) => {
    const settings = new SettingsPage(page);
    const name = `persona-${Date.now()}`;
    const content = 'You are a helpful assistant that speaks like a pirate.';
    const editedContent = 'You are a helpful assistant that speaks formally.';

    await settings.goto();
    await settings.openSection('Persona Prompts');

    await page
      .getByRole('button', { name: 'Add Persona Prompt' })
      .first()
      .click();
    await page.getByPlaceholder('Persona Prompt Name').fill(name);
    await page.getByPlaceholder(/Persona prompt content/).fill(content);
    await page
      .getByRole('button', { name: 'Add Persona Prompt' })
      .last()
      .click();

    // Other specs leave persona prompts seeded in the shared test DB (and a
    // hardcoded content string like `content` could coincidentally match a
    // leftover prompt from a retried attempt), so scope everything to this
    // prompt's own card, matched by its unique name, rather than a page-wide
    // text search. The still-open "Add" form shares the card's base classes
    // and (briefly, until its own state settles) still shows `content` in its
    // textarea too — scoping by `name` excludes it, since the form clears its
    // name field before the card row renders.
    const card = () =>
      page
        .locator('div.p-3.border.border-surface-2.rounded-control.bg-surface-2')
        .filter({ hasText: name });

    await expect(card()).toBeVisible();
    await expect(card().getByText(content, { exact: true })).toBeVisible();

    type PromptRecord = { id: string; name: string; content: string };
    const listPrompts = async (): Promise<PromptRecord[]> =>
      (await request.get('/api/system-prompts')).json();

    const created = (await listPrompts()).find((p) => p.name === name);
    expect(created?.content).toBe(content);

    // Edit — change content and save. There's no GET /api/system-prompts/[id]
    // route, so verify the persisted change via the list endpoint.
    await card().getByTitle('Edit').click();
    // Editing renders a "Prompt Content" placeholder textarea (distinct from
    // the "Add" form's "Persona prompt content…" one), unique while editing.
    await page.getByPlaceholder('Prompt Content').fill(editedContent);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      card().getByText(editedContent, { exact: true }),
    ).toBeVisible();

    const afterEdit = (await listPrompts()).find((p) => p.id === created!.id);
    expect(afterEdit?.content).toBe(editedContent);

    // Delete — confirm() is used by the settings panel.
    page.once('dialog', (d) => d.accept());
    await card().getByTitle('Delete').click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);

    const afterDelete = (await listPrompts()).find((p) => p.id === created!.id);
    expect(afterDelete).toBeUndefined();
  });

  test('skill: create then toggle enable/disable persists via the API', async ({
    page,
    request,
  }) => {
    const settings = new SettingsPage(page);
    const name = `skill-${Date.now()}`.toLowerCase();

    await settings.goto();
    await settings.openSection('Skills');

    // Invalid name is rejected before the request is sent.
    await page.getByRole('button', { name: 'New skill' }).click();
    await page
      .getByPlaceholder('skill-name (lowercase, hyphens ok)')
      .fill('Invalid Name');
    await page
      .getByPlaceholder('One-line description shown in autocomplete')
      .fill('desc');
    await page
      .getByPlaceholder('Full skill body (markdown supported)')
      .fill('body');
    await page.getByRole('button', { name: 'Create' }).click();
    // The validation message is a sonner toast with sonner's default 4s
    // lifetime — under heavy parallel-suite load the render itself can be
    // delayed, so give this more room than the default 5s to still catch it
    // within that visible window rather than racing it.
    await expect(
      page.getByText('Name must match pattern: [a-z0-9][a-z0-9_:-]*'),
    ).toBeVisible({ timeout: 10_000 });

    // Valid name succeeds.
    await page
      .getByPlaceholder('skill-name (lowercase, hyphens ok)')
      .fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('code', { hasText: name })).toBeVisible();

    const listRes = await request.get('/api/skills');
    const skills: Array<{ id: string; name: string; enabled: boolean }> =
      await listRes.json();
    const created = skills.find((s) => s.name === name);
    expect(created?.enabled).toBe(true);

    // Disable it via the row's AppSwitch. Other specs leave skills seeded in
    // the shared test DB, so scope to this skill's own row, not just any switch.
    const row = page
      .locator('div.p-3.border.border-surface-2.rounded-control.bg-surface-2')
      .filter({ hasText: name });
    await row.getByRole('switch').click();

    await expect
      .poll(async () => {
        const res = await request.get(`/api/skills/${created!.id}`);
        return (await res.json()).enabled;
      })
      .toBe(false);
  });

  test('MCP server add form validates required fields, then creates on valid input', async ({
    page,
    request,
  }) => {
    const settings = new SettingsPage(page);
    const name = `mcp-${Date.now()}`;
    // Unique URL — other specs seed servers with the plain example.com URL,
    // and this list isn't scoped per-test, so a shared value would collide.
    const url = `https://example.com/mcp?t=${Date.now()}`;

    await settings.goto();
    await settings.openSection('MCP Servers');

    await page.getByRole('button', { name: 'Add MCP Server' }).click();
    // Submitting without name/URL is rejected client-side (no request sent).
    await page.getByRole('button', { name: 'Add Server' }).click();
    await expect(page.getByText('Name and URL are required')).toBeVisible();

    await page.getByLabel('Server name').fill(name);
    await page.getByLabel('Server URL').fill(url);
    await page.getByRole('button', { name: 'Add Server' }).click();

    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText(url, { exact: true })).toBeVisible();

    const listRes = await request.get('/api/mcp/servers');
    const body: {
      servers: Array<{ name: string; url: string; authType: string }>;
    } = await listRes.json();
    const created = body.servers.find((s) => s.name === name);
    expect(created?.url).toBe(url);
    expect(created?.authType).toBe('none');
  });
});
