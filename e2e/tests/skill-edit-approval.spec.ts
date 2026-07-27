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
  });
});
