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
  for (const button of await footer.getByRole('button').all()) {
    await expect(button).toHaveClass(/(^|\s)px-5(\s|$)/);
    await expect(button).toHaveClass(/(^|\s)py-2(\s|$)/);
    await expect(button).toHaveClass(/(^|\s)text-sm(\s|$)/);
  }
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

  test('soft approval buttons keep their fill and add a semantic hover border', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: 'approval-soft-buttons',
    });
    await seedWorkspaceFile(request, wsId, {
      name: 'soft-buttons.txt',
      content: 'before',
    });

    const { chatId, messageId } = await seedAwaitingWorkspaceEdit(wsId, {
      file: 'soft-buttons.txt',
      oldString: 'before',
      newString: 'after',
    });

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    const panel = page.locator('[data-approval-panel]');
    const reject = panel
      .locator('[data-approval-footer]')
      .getByRole('button', { name: 'Reject' });
    await expect(reject).toHaveClass(/(^|\s)px-5(\s|$)/);
    await expect(reject).toHaveClass(/(^|\s)bg-danger-soft(\s|$)/);
    await expect(reject).toHaveClass(/(^|\s)border-transparent(\s|$)/);

    const expected = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'bg-danger-soft text-danger border-danger';
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const result = {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderTopColor,
      };
      probe.remove();
      return result;
    });
    const before = await reject.boundingBox();
    expect(before).not.toBeNull();

    await reject.hover();
    await expect
      .poll(() =>
        reject.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            color: style.color,
            border: style.borderTopColor,
          };
        }),
      )
      .toEqual(expected);

    const after = await reject.boundingBox();
    expect(after).toEqual(before);

    await cancelAwaitingRun(request, { chatId, messageId });
  });

  test('a rejection can be cancelled with Escape before submitting a trimmed reason', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: 'approval-rejection-flow',
    });
    await seedWorkspaceFile(request, wsId, {
      name: 'rejection-flow.txt',
      content: 'before',
    });

    const { chatId } = await seedAwaitingWorkspaceEdit(wsId, {
      file: 'rejection-flow.txt',
      oldString: 'before',
      newString: 'after',
    });

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    const panel = page.locator('[data-approval-panel]');
    const reject = panel.getByRole('button', { name: 'Reject' });
    await reject.click();

    const reason = panel.getByLabel('Rejection reason');
    await expect(reason).toBeFocused();
    await reason.fill('discard this attempt');
    await reason.press('Escape');
    await expect(reason).toBeHidden();
    await expect(reject).toBeFocused();

    await reject.click();
    await reason.fill('  keep the existing wording  ');
    const resume = page.waitForRequest(
      (candidate) =>
        candidate.url().includes('/api/chat/runs/resume') &&
        candidate.method() === 'POST',
    );
    await reason.press('Enter');
    const body = JSON.parse((await resume).postData() ?? '{}') as {
      response?: Record<string, unknown>;
    };
    expect(body.response).toEqual({
      decision: 'reject',
      freeformText: 'keep the existing wording',
    });
    await expect(panel).toBeHidden();
  });

  test('a skill edit renders the shared chrome and has an optional rejection', async ({
    page,
    request,
  }) => {
    const name = `approval-shell-${Date.now()}`;
    const wsId = await seedWorkspace(request, { name: 'approval-shell-skill' });
    await seedSkill(request, { name });

    const { chatId } = await seedAwaitingSkillEdit(
      { name, scope: 'global', newScope: 'workspace' },
      wsId,
    );

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    await expectPanelChrome(page, 'Update skill');

    const panel = page.locator('[data-approval-panel]');
    await panel.getByRole('button', { name: 'Reject' }).click();
    await expect(panel.getByLabel('Rejection reason')).toBeVisible();

    const resume = page.waitForRequest(
      (candidate) =>
        candidate.url().includes('/api/chat/runs/resume') &&
        candidate.method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Send rejection' }).click();
    const body = JSON.parse((await resume).postData() ?? '{}') as {
      response?: Record<string, unknown>;
    };
    expect(body.response).toEqual({ decision: 'reject' });
    await expect(panel).toBeHidden();
  });
});
