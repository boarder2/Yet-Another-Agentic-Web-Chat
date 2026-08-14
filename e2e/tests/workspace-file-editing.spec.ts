import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  cancelAwaitingRun,
  seedWorkspace,
  seedWorkspaceFile,
  seedAwaitingWorkspaceEdit,
} from '../utils/seed';

async function overridePendingPayload(
  page: Page,
  patch: Record<string, unknown>,
) {
  await page.route(/\/api\/approvals\/pending\?chatId=/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      pending: Array<{ payload: Record<string, unknown> }>;
    };
    await route.fulfill({
      response,
      json: {
        ...body,
        pending: body.pending.map((approval, index) =>
          index === 0
            ? { ...approval, payload: { ...approval.payload, ...patch } }
            : approval,
        ),
      },
    });
  });
}

test.describe('workspace file editing', () => {
  test('an agent edit never discards an unsaved draft', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    await seedWorkspaceFile(request, wsId, {
      name: 'notes.txt',
      content: 'hello world',
    });

    // Park the agent's edit at its approval interrupt. The file viewer is a
    // full-screen modal, so the composer is unreachable once it's open — the run
    // has to already be in flight for the collision to be reachable at all.
    const { chatId, approvalId } = await seedAwaitingWorkspaceEdit(wsId, {
      file: 'notes.txt',
      oldString: 'hello',
      newString: 'GOODBYE',
    });

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);

    const sidebar = page.locator('aside');
    await sidebar.getByRole('button', { name: 'Files' }).click();
    await sidebar.getByRole('button', { name: 'notes.txt' }).click();

    const modal = page.getByRole('dialog');
    const draft = modal.getByLabel('File content');
    await modal.getByRole('button', { name: 'Edit' }).click();
    await draft.fill('MY UNSAVED DRAFT');

    // The edit lands while the draft is dirty: the run is resumed out of band,
    // exactly as if the user had approved it before opening the file.
    const res = await request.post('/api/chat/runs/resume', {
      data: { approvalId, response: { decision: 'accept' } },
    });
    expect(res.status()).toBe(200);

    // The unsaved work survives, and the collision is surfaced instead of the
    // newer version being silently overwritten (or the draft silently dropped).
    await expect(
      modal.getByText(/changed since you started editing/i),
    ).toBeVisible();
    await expect(draft).toContainText('MY UNSAVED DRAFT');

    // Discarding adopts the agent's version.
    await modal.getByRole('button', { name: 'Discard mine' }).click();
    await expect(modal.getByText('GOODBYE world')).toBeVisible();
  });

  test('the per-file edit icon opens the editor, skipping the preview', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    await seedWorkspaceFile(request, wsId, {
      name: 'notes.txt',
      content: 'hello world',
    });

    await page.goto(`/workspaces/${wsId}`);

    const sidebar = page.locator('aside');
    await sidebar.getByRole('button', { name: 'Files' }).click();
    await sidebar.getByRole('button', { name: 'Edit' }).click();

    // Straight into the editor — no preview, no second Edit click.
    const modal = page.getByRole('dialog');
    await expect(modal.getByLabel('File content')).toContainText('hello world');
    await expect(modal.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('replace-all approvals show one representative replacement banner', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: 'workspace-replace-all',
    });
    await seedWorkspaceFile(request, wsId, {
      name: 'replace-all.txt',
      content: 'target',
    });

    const { chatId } = await seedAwaitingWorkspaceEdit(wsId, {
      file: 'replace-all.txt',
      oldString: 'target',
      newString: 'replacement',
    });
    await overridePendingPayload(page, { replaceAll: true, occurrences: 3 });

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    const panel = page.locator('[data-approval-panel]');
    await expect(
      panel.getByText('Showing 1 of 3 replacements', { exact: true }),
    ).toBeVisible();
    await expect(panel.locator('table tbody tr')).toHaveCount(2);
    await expect(panel.locator('table tbody tr').first()).toHaveClass(
      /bg-danger-soft/,
    );
    await expect(panel.locator('table tbody tr').last()).toHaveClass(
      /bg-success-soft/,
    );

    await panel.getByRole('button', { name: 'Reject' }).click();
    await panel.getByRole('button', { name: 'Send rejection' }).click();
    await expect(panel).toBeHidden();
  });

  test('an empty create preview keeps one visible added line', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: 'workspace-empty-create',
    });
    await seedWorkspaceFile(request, wsId, {
      name: 'source.txt',
      content: 'before',
    });

    const { chatId } = await seedAwaitingWorkspaceEdit(wsId, {
      file: 'source.txt',
      oldString: 'before',
      newString: 'after',
    });
    await overridePendingPayload(page, {
      action: 'create',
      file: 'empty-created.txt',
      content: '',
    });

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    const panel = page.locator('[data-approval-panel]');
    await expect(panel.getByText('Create file', { exact: true })).toBeVisible();
    const row = panel.locator('table tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveClass(/bg-success-soft/);
    await expect(row.locator('td').first()).toHaveText('1');
    await expect(row.locator('span').first()).toHaveText('+');

    await panel.getByRole('button', { name: 'Reject' }).click();
    await panel.getByRole('button', { name: 'Send rejection' }).click();
    await expect(panel).toBeHidden();
  });

  test('large approval diffs stay bounded while keeping the footer reachable', async ({
    page,
    request,
  }) => {
    const lineCount = 175;
    const oldContent = Array.from(
      { length: lineCount },
      (_, index) => `old line ${index + 1}`,
    ).join('\n');
    const newContent = Array.from(
      { length: lineCount },
      (_, index) => `new line ${index + 1}`,
    ).join('\n');
    const wsId = await seedWorkspace(request, { name: 'workspace-large-diff' });
    await seedWorkspaceFile(request, wsId, {
      name: 'large-diff.txt',
      content: oldContent,
    });

    const { chatId, messageId } = await seedAwaitingWorkspaceEdit(wsId, {
      file: 'large-diff.txt',
      oldString: oldContent,
      newString: newContent,
    });

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    const panel = page.locator('[data-approval-panel]');
    const body = panel.locator('div.flex-1.min-h-0.overflow-y-auto');
    await expect(panel.locator('table tbody tr')).toHaveCount(lineCount * 2);
    await expect
      .poll(() =>
        body.evaluate((element) => element.scrollHeight > element.clientHeight),
      )
      .toBe(true);
    await expect(
      panel.locator('[data-approval-footer]').getByRole('button').first(),
    ).toBeInViewport();

    await cancelAwaitingRun(request, { chatId, messageId });
  });
});
