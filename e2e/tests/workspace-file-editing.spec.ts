import { test, expect } from '../fixtures';
import {
  seedWorkspace,
  seedWorkspaceFile,
  seedAwaitingWorkspaceEdit,
} from '../utils/seed';

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

    const modal = page.locator('.fixed.inset-0.z-50');
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
    const modal = page.locator('.fixed.inset-0.z-50');
    await expect(modal.getByLabel('File content')).toContainText('hello world');
    await expect(modal.getByRole('button', { name: 'Save' })).toBeVisible();
  });
});
