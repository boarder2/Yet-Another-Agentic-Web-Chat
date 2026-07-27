import { test, expect } from '../fixtures';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { seedSkill, seedWorkspace } from '../utils/seed';

const skillRow = (page: HomePage['page'], name: string) =>
  page
    .locator('div.p-3.border.border-surface-2.rounded-control.bg-surface-2')
    .filter({ hasText: name });

test.describe('skills settings', () => {
  test('an existing skill can be re-scoped to a workspace and back', async ({
    page,
    request,
  }) => {
    const name = `scope-edit-${Date.now()}`;
    const workspaceName = `skill-scope-ws-${Date.now()}`;
    const workspaceId = await seedWorkspace(request, { name: workspaceName });
    const skillId = await seedSkill(request, { name });

    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.openSection('Skills');

    const row = skillRow(page, name);
    await expect(row.getByText('Global')).toBeVisible();

    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Scope:').selectOption({ label: workspaceName });
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(row.getByText(workspaceName)).toBeVisible();
    await expect
      .poll(async () => {
        const res = await request.get(`/api/skills/${skillId}`);
        return (await res.json()).workspaceId;
      })
      .toBe(workspaceId);

    // And back to global — the move must not be one-way.
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Scope:').selectOption({ label: 'Global' });
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(row.getByText('Global')).toBeVisible();
    await expect
      .poll(async () => {
        const res = await request.get(`/api/skills/${skillId}`);
        return (await res.json()).workspaceId;
      })
      .toBe(null);
  });

  test('re-scoping a skill away from the open workspace drops it from the composer autocomplete without a reload', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const name = `autocomplete-scope-${stamp}`;
    const otherName = `skill-autocomplete-other-${stamp}`;
    const workspaceId = await seedWorkspace(request, {
      name: `skill-autocomplete-ws-${stamp}`,
    });
    await seedWorkspace(request, { name: otherName });
    await seedSkill(request, { name, workspaceId });

    const chat = new HomePage(page);
    await chat.goto(`/?workspace=${workspaceId}`);

    const suggestion = page.getByRole('button', { name: `/${name}` });
    await chat.input.fill(`/${name}`);
    await expect(suggestion).toBeVisible();
    await chat.input.fill('');

    const settings = new SettingsPage(page);
    await page.getByLabel('Settings').first().click();
    await settings.openSection('Skills');
    const row = skillRow(page, name);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Scope:').selectOption({ label: otherName });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText(otherName)).toBeVisible();
    await settings.close();

    await chat.input.fill(`/${name}`);
    await expect(suggestion).toBeHidden();
  });
});
