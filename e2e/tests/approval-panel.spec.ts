import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  cancelAwaitingRun,
  seedAwaitingApproval,
  seedAwaitingSkillEdit,
  seedAwaitingWorkspaceEdit,
  seedSkill,
  seedWorkspace,
  seedWorkspaceFile,
} from '../utils/seed';

/**
 * Every in-message approval renders through the shared ApprovalPanel shell, so
 * the chrome contract is asserted once here rather than in each kind's spec.
 */
const expectPanelChrome = async (page: Page, title: string | RegExp) => {
  const panel = page.locator('[data-approval-panel]');
  await expect(panel).toBeVisible();

  // Header states what is being approved and that the run is blocked on the user.
  await expect(panel.getByText(title)).toBeVisible();
  await expect(panel.getByText('Waiting on input')).toBeVisible();

  // The panel is always dismissible from the header, without reaching for a
  // footer action.
  await expect(
    panel
      .locator('[data-approval-header]')
      .getByRole('button', { name: /Dismiss|Skip/ }),
  ).toBeVisible();

  // The action row is reachable regardless of body length: the panel caps its
  // own height and scrolls the body, so the footer stays inside the viewport.
  const footer = panel.locator('[data-approval-footer]');
  await expect(footer).toBeVisible();
  await expect(footer.getByRole('button').first()).toBeInViewport();
};

test.describe('approval panel shell', () => {
  test('an agent question renders the shared chrome', async ({
    page,
    request,
  }) => {
    const { chatId, messageId } = await seedAwaitingApproval();

    await page.goto(`/c/${chatId}`);
    await expectPanelChrome(page, 'Agent has a question');

    await cancelAwaitingRun(request, { chatId, messageId });
  });

  test('a workspace file edit renders the shared chrome and names the file', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, { name: 'approval-shell-ws' });
    await seedWorkspaceFile(request, wsId, {
      name: 'notes.md',
      content: 'before',
    });

    const { chatId, messageId } = await seedAwaitingWorkspaceEdit(wsId, {
      file: 'notes.md',
      oldString: 'before',
      newString: 'after',
    });

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    await expectPanelChrome(page, 'Edit file');

    // The identifier chip is part of the header contract, not the body.
    await expect(
      page.locator('[data-approval-panel]').getByText('notes.md'),
    ).toBeVisible();

    await cancelAwaitingRun(request, { chatId, messageId });
  });

  test('a skill edit renders the shared chrome', async ({ page, request }) => {
    const name = `approval-shell-${Date.now()}`;
    const wsId = await seedWorkspace(request, { name: 'approval-shell-skill' });
    await seedSkill(request, { name });

    const { chatId } = await seedAwaitingSkillEdit(
      { name, scope: 'global', newScope: 'workspace' },
      wsId,
    );

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    await expectPanelChrome(page, 'Update skill');

    await page.getByRole('button', { name: 'Reject' }).click();
  });
});
