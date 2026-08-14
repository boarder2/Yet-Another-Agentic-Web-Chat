import { test, expect } from '../fixtures';
import { seedWorkspace, seedWorkspaceFile } from '../utils/seed';
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

  test('a formerly native file confirmation is cancelable by keyboard without deleting', async ({
    page,
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: `ws-confirm-cancel-${Date.now()}`,
    });
    const fileName = `cancel-${Date.now()}.md`;
    await seedWorkspaceFile(request, workspaceId, { name: fileName });

    let nativeDialogSeen = false;
    page.on('dialog', async (dialog) => {
      nativeDialogSeen = true;
      await dialog.dismiss();
    });

    const detail = new WorkspaceDetailPage(page);
    await detail.goto(workspaceId);
    await detail.expandSection('Files');

    const fileSection = page
      .locator('[data-workspace-section]')
      .filter({ hasText: fileName });
    const row = fileSection.locator('li').filter({ hasText: fileName });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();

    const confirm = page
      .getByRole('dialog')
      .filter({ hasText: 'Delete file?' });
    await expect(confirm).toBeVisible();
    expect(nativeDialogSeen).toBe(false);

    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(row).toBeVisible();
  });

  test('workspace deletion requires its exact name and closes after success', async ({
    page,
    request,
  }) => {
    const workspaceName = `ws-confirm-typed-${Date.now()}`;
    const workspaceId = await seedWorkspace(request, { name: workspaceName });
    const detail = new WorkspaceDetailPage(page);

    try {
      await detail.goto(workspaceId);
      await detail.openSettings();
      const settings = page.getByRole('dialog');
      await settings
        .getByRole('button', { name: 'Delete', exact: true })
        .click();

      const confirm = page
        .getByRole('dialog')
        .filter({ hasText: 'Delete workspace?' });
      const input = confirm.getByLabel(
        `Confirm workspace name: ${workspaceName}`,
      );
      const deleteButton = confirm.getByRole('button', {
        name: 'Delete',
        exact: true,
      });

      await expect(input).toBeVisible();
      await expect(deleteButton).toBeDisabled();
      await input.fill('not-the-workspace-name');
      await expect(deleteButton).toBeDisabled();

      await input.fill(workspaceName);
      await expect(deleteButton).toBeEnabled();

      const deletion = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/workspaces/${workspaceId}`) &&
          response.request().method() === 'DELETE',
      );
      await deleteButton.click();
      expect((await deletion).status()).toBe(204);
      await expect(confirm).toBeHidden();
      await expect(page).toHaveURL(/\/workspaces\/?$/);
    } finally {
      const cleanup = await request.delete(`/api/workspaces/${workspaceId}`);
      expect([200, 404]).toContain(cleanup.status());
    }
  });

  test('a failed deletion stays open, stops loading, and can be retried successfully', async ({
    page,
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: `ws-confirm-retry-${Date.now()}`,
    });
    const fileName = `retry-${Date.now()}.md`;
    const fileId = await seedWorkspaceFile(request, workspaceId, {
      name: fileName,
    });
    const fileUrl = `/api/workspaces/${workspaceId}/files/${fileId}`;

    let deleteAttempts = 0;
    let releaseFirstAttempt!: () => void;
    const firstAttemptReleased = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    let firstDeleteStarted!: () => void;
    const firstDeleteStartedPromise = new Promise<void>((resolve) => {
      firstDeleteStarted = resolve;
    });

    await page.route(`**${fileUrl}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }

      deleteAttempts += 1;
      if (deleteAttempts === 1) {
        firstDeleteStarted();
        await firstAttemptReleased;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'held test failure' }),
        });
        return;
      }

      await route.continue();
    });

    const detail = new WorkspaceDetailPage(page);
    await detail.goto(workspaceId);
    await detail.expandSection('Files');
    const fileSection = page
      .locator('[data-workspace-section]')
      .filter({ hasText: fileName });
    const row = fileSection.locator('li').filter({ hasText: fileName });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();

    const confirm = page
      .getByRole('dialog')
      .filter({ hasText: 'Delete file?' });
    const deleteButton = confirm.getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    const cancelButton = confirm.getByRole('button', {
      name: 'Cancel',
      exact: true,
    });
    await expect(confirm).toBeVisible();

    const failedDeletion = page.waitForResponse(
      (response) =>
        response.url().endsWith(fileUrl) &&
        response.request().method() === 'DELETE',
    );
    await deleteButton.click();
    await firstDeleteStartedPromise;
    await expect(deleteButton).toBeDisabled();
    await expect(deleteButton).toHaveAttribute('aria-busy', 'true');
    await expect(cancelButton).toBeDisabled();
    expect(deleteAttempts).toBe(1);

    releaseFirstAttempt();
    expect((await failedDeletion).status()).toBe(500);
    await expect(confirm).toBeVisible();
    await expect(deleteButton).toBeEnabled();
    await expect(deleteButton).not.toHaveAttribute('aria-busy');
    await expect(row).toBeVisible();

    const successfulDeletion = page.waitForResponse(
      (response) =>
        response.url().endsWith(fileUrl) &&
        response.request().method() === 'DELETE',
    );
    await deleteButton.click();
    expect((await successfulDeletion).status()).toBe(200);
    await expect(confirm).toBeHidden();
    await expect(row).toBeHidden();
    expect(deleteAttempts).toBe(2);
  });
});
