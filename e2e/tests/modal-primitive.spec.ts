import { test, expect } from '../fixtures';
import { seedWorkspace } from '../utils/seed';
import { WorkspacesPage } from '../pages/WorkspacesPage';
import { WorkspaceDetailPage } from '../pages/WorkspaceDetailPage';
import { MemoryPage } from '../pages/MemoryPage';

/**
 * Accessibility contract owned by the shared Modal primitive
 * (`src/components/ui/Modal.tsx`), exercised through three call sites that
 * previously hand-rolled their own shells and had none of it.
 */
test.describe('modal primitive', () => {
  test('the create-workspace modal exposes role=dialog, traps focus and closes on Escape', async ({
    page,
  }) => {
    const listPage = new WorkspacesPage(page);
    await listPage.goto();
    await page
      .getByRole('button', { name: /new workspace/i })
      .first()
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // headlessui moves initial focus into the panel, so tabbing stays inside it.
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the workspace delete confirmation is a dialog and closes on Escape', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: `ws-modal-${Date.now()}`,
    });
    const detail = new WorkspaceDetailPage(page);
    await detail.goto(wsId);
    await detail.openSettings();

    const settings = page.getByRole('dialog');
    await settings.getByRole('button', { name: 'Delete' }).first().click();

    // The confirm replaces the settings dialog as the active one.
    const confirm = page.getByRole('dialog').filter({
      hasText: 'Delete workspace?',
    });
    await expect(confirm).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
  });

  test('the settings modal renders as a dialog and closes on Escape', async ({
    page,
  }) => {
    const memory = new MemoryPage(page);
    await memory.goto('/');
    await memory.open();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Close')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
