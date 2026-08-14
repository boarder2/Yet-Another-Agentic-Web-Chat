import { test, expect } from '../fixtures';
import { seedSkill, seedWorkspace, seedAwaitingSkillEdit } from '../utils/seed';

test.describe('skill edit approval', () => {
  test('a scope-only move states what will change, and applies on accept', async ({
    page,
    request,
  }) => {
    const name = `approval-move-${Date.now()}`;
    const wsId = await seedWorkspace(request, { name: `skill-approval-ws` });
    const skillId = await seedSkill(request, { name });

    // Nothing about the description or content changes here, so the diff is
    // empty — the panel still has to say what the user is approving.
    const { chatId } = await seedAwaitingSkillEdit(
      { name, scope: 'global', newScope: 'workspace' },
      wsId,
    );

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);

    // Assert against the body's change summary, not the header chip — the
    // panel's job is to state the change where the user reads the proposal.
    const summary = page.locator('dl');
    await expect(summary.getByText('Scope')).toBeVisible();
    await expect(summary.getByText('global → workspace')).toBeVisible();
    await expect(page.getByText(/No changes/)).toBeHidden();

    await page.getByRole('button', { name: 'Accept' }).click();

    await expect
      .poll(async () => {
        const res = await request.get(`/api/skills/${skillId}`);
        return (await res.json()).workspaceId;
      })
      .toBe(wsId);
  });

  test('a proposal that changes nothing says so rather than rendering an empty panel', async ({
    page,
    request,
  }) => {
    const name = `approval-noop-${Date.now()}`;
    const wsId = await seedWorkspace(request, { name: 'skill-approval-noop' });
    await seedSkill(request, { name });

    const { chatId } = await seedAwaitingSkillEdit(
      { name, scope: 'global' },
      wsId,
    );

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);

    await expect(page.getByText('Update skill')).toBeVisible();
    await expect(page.getByText(/No changes/)).toBeVisible();

    // Resolve it so the run doesn't leak an unanswered approval.
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByRole('button', { name: 'Send rejection' }).click();
  });

  test('the content diff preserves context, removed, and added line meaning', async ({
    page,
    request,
  }) => {
    const name = `approval-diff-${Date.now()}`;
    const wsId = await seedWorkspace(request, { name: 'skill-approval-diff' });
    await seedSkill(request, {
      name,
      content: 'keep this line\nremove this line',
    });

    const { chatId } = await seedAwaitingSkillEdit(
      {
        name,
        scope: 'global',
        content: 'keep this line\nadd this line',
      },
      wsId,
    );

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);
    const panel = page.locator('[data-approval-panel]');
    const rows = panel.locator('table tbody tr');
    await expect(rows).toHaveCount(3);

    const context = rows.filter({ hasText: 'keep this line' });
    const removed = rows.filter({ hasText: 'remove this line' });
    const added = rows.filter({ hasText: 'add this line' });

    await expect(context).not.toHaveClass(/bg-danger-soft|bg-success-soft/);
    await expect(context.locator('td').first()).toHaveText('1');
    await expect(context.locator('span').first()).toHaveClass(/text-fg-muted/);

    await expect(removed).toHaveClass(/(^|\s)bg-danger-soft(\s|$)/);
    await expect(removed.locator('span').first()).toHaveText('−');
    await expect(removed.locator('td').first()).toHaveText('2');
    await expect(removed.locator('span').first()).toHaveClass(/text-danger/);

    await expect(added).toHaveClass(/(^|\s)bg-success-soft(\s|$)/);
    await expect(added.locator('span').first()).toHaveText('+');
    await expect(added.locator('td').first()).toHaveText('2');
    await expect(added.locator('span').first()).toHaveClass(/text-success/);

    await panel.getByRole('button', { name: 'Reject' }).click();
    await panel.getByRole('button', { name: 'Send rejection' }).click();
    await expect(panel).toBeHidden();
  });

  test('an auto-invocation flip is spelled out even with no text diff', async ({
    page,
    request,
  }) => {
    const name = `approval-invocation-${Date.now()}`;
    const wsId = await seedWorkspace(request, { name: 'skill-approval-inv' });
    await seedSkill(request, { name });

    const { chatId } = await seedAwaitingSkillEdit(
      { name, scope: 'global', disableModelInvocation: true },
      wsId,
    );

    await page.goto(`/workspaces/${wsId}/c/${chatId}`);

    const summary = page.locator('dl');
    await expect(summary.getByText('Invocation')).toBeVisible();
    await expect(
      summary.getByText('model + slash command → slash command only'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByRole('button', { name: 'Send rejection' }).click();
  });
});
