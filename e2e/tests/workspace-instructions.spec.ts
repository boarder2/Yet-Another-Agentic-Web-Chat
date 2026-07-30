import { test, expect } from '../fixtures';
import { seedWorkspace } from '../utils/seed';

const MODAL = '[role="dialog"]';

test.describe('workspace instructions editing', () => {
  test('opens to a rendered preview, then edits and saves', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      instructions: '# House rules\n\nAlways cite sources.',
    });

    await page.goto(`/workspaces/${wsId}`);
    const sidebar = page.locator('aside');
    await sidebar.getByRole('button', { name: 'Instructions' }).click();
    await sidebar
      .getByRole('button', { name: 'Open workspace instructions' })
      .click();

    // Preview first: markdown is rendered, the editor is not mounted yet.
    const modal = page.locator(MODAL);
    await expect(
      modal.getByRole('heading', { name: 'House rules' }),
    ).toBeVisible();
    await expect(modal.getByLabel('Workspace instructions')).toHaveCount(0);

    await modal.getByRole('button', { name: 'Edit' }).click();
    const draft = modal.getByLabel('Workspace instructions');
    await expect(draft).toContainText('Always cite sources.');

    await draft.fill('# New rules\n\nBe terse.');
    await modal.getByRole('button', { name: 'Save' }).click();

    // Back to the preview, showing what was saved.
    await expect(
      modal.getByRole('heading', { name: 'New rules' }),
    ).toBeVisible();

    const res = await request.get(`/api/workspaces/${wsId}`);
    expect((await res.json()).workspace.instructions).toBe(
      '# New rules\n\nBe terse.',
    );
  });

  test('the edit icon opens the editor, skipping the preview', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      instructions: 'existing guidance',
    });

    await page.goto(`/workspaces/${wsId}`);
    const sidebar = page.locator('aside');
    await sidebar.getByRole('button', { name: 'Instructions' }).click();
    await sidebar.getByRole('button', { name: 'Edit' }).click();

    const modal = page.locator(MODAL);
    await expect(modal.getByLabel('Workspace instructions')).toContainText(
      'existing guidance',
    );
    await expect(modal.getByRole('button', { name: 'Save' })).toBeVisible();
  });
});
