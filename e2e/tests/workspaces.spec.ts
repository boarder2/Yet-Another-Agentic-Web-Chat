import { test, expect } from '../fixtures';
import { seedWorkspace } from '../utils/seed';
import { WorkspacesPage } from '../pages/WorkspacesPage';
import { WorkspaceDetailPage } from '../pages/WorkspaceDetailPage';

const FILE_NAME = 'notes.md';
const URL_VALUE = 'https://example.com';

test.describe('workspaces CRUD', () => {
  test('create a workspace via UI, rename it, add and remove file/URL, archive and unarchive', async ({
    page,
    request,
  }) => {
    const listPage = new WorkspacesPage(page);
    const uniqueName = `ws-ui-${Date.now()}`;

    // ── Create ──
    await listPage.goto();
    const wsId = await listPage.createWorkspace(uniqueName);

    // After creation, the page navigated to the new workspace. Go back to list.
    await listPage.goto();

    // Identity-based: verify our workspace is in the list (no exact-count
    // assertion — parallel tests share the same DB and perturb totals).
    const names = await listPage.cardNames();
    expect(names).toContain(uniqueName);

    // ── Rename ──
    const detailPage = new WorkspaceDetailPage(page);
    await detailPage.goto(wsId);

    const newName = `${uniqueName}-renamed`;
    await detailPage.rename(newName);
    await detailPage.closeSettings();

    // Assert the header reflects the new name.
    const headerName = await detailPage.headerName();
    expect(headerName).toBe(newName);

    // Reload and verify the rename persisted via the API.
    const getRes = await request.get(`/api/workspaces/${wsId}`);
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    expect(body.workspace.name).toBe(newName);

    // ── Add file ──
    await detailPage.addFile(FILE_NAME);
    const fileNames = await detailPage.fileNames();
    expect(fileNames).toContain(FILE_NAME);

    // Verify file persisted via API.
    const filesRes = await request.get(`/api/workspaces/${wsId}/files`);
    const filesBody = await filesRes.json();
    const fileInApi = filesBody.files.find(
      (f: { name: string }) => f.name === FILE_NAME,
    );
    expect(fileInApi).toBeDefined();

    // ── Remove file ──
    await detailPage.removeFile(FILE_NAME);
    const namesAfterRemove = await detailPage.fileNames();
    expect(namesAfterRemove).not.toContain(FILE_NAME);

    // ── Add URL ──
    await detailPage.addUrl(URL_VALUE);
    const urls = await detailPage.urlValues();
    expect(urls).toContain(URL_VALUE);

    // Verify URL persisted via API.
    const urlsRes = await request.get(`/api/workspaces/${wsId}/urls`);
    const urlsBody = await urlsRes.json();
    expect(urlsBody.urls).toContain(URL_VALUE);

    // ── Remove URL ──
    await detailPage.removeUrl(URL_VALUE);
    const urlsAfterRemove = await detailPage.urlValues();
    expect(urlsAfterRemove).not.toContain(URL_VALUE);

    // ── Archive ──
    await detailPage.archive();
    await detailPage.closeSettings();

    // Verify the workspace left the active list.
    await listPage.goto();
    const activeNames = await listPage.cardNames();
    expect(activeNames).not.toContain(newName);

    // Verify it appears under Archived.
    await listPage.toggleArchived();
    expect(await listPage.isShowingArchived()).toBe(true);
    const archivedNames = await listPage.cardNames();
    expect(archivedNames).toContain(newName);

    // ── Unarchive ──
    await listPage.openCard(newName);
    const detailPage2 = new WorkspaceDetailPage(page);
    await detailPage2.unarchive();
    await detailPage2.closeSettings();

    // Verify it's back in the active list. Navigating resets the list to the
    // default Active view, so no toggle is needed.
    await listPage.goto();
    const activeAfterUnarchive = await listPage.cardNames();
    expect(activeAfterUnarchive).toContain(newName);
  });

  test('workspace card renders optional description', async ({
    page,
    request,
  }) => {
    const desc = `A test description ${Date.now()}`;
    await seedWorkspace(request, {
      name: `ws-desc-${Date.now()}`,
      description: desc,
    });

    const listPage = new WorkspacesPage(page);
    await listPage.goto();

    // The description text should be visible on the workspace card (only when
    // a description was set — the conditional branch `ws.description && (...)`).
    await expect(page.getByText(desc)).toBeVisible();
  });

  test('multiple workspaces: archive one leaves the other active', async ({
    page,
    request,
  }) => {
    // Seed two workspaces with unique, filterable names.
    const nameA = `ws-multi-a-${Date.now()}`;
    const nameB = `ws-multi-b-${Date.now()}`;
    await seedWorkspace(request, { name: nameA });
    await seedWorkspace(request, { name: nameB });

    const listPage = new WorkspacesPage(page);
    await listPage.goto();

    // Both appear in the active list (identity-based — filter to our seeded
    // names so parallel-test noise doesn't affect assertions).
    const activeBefore = await listPage.cardNames();
    expect(activeBefore.filter((n) => n === nameA)).toHaveLength(1);
    expect(activeBefore.filter((n) => n === nameB)).toHaveLength(1);

    // Archive workspace A via the detail page.
    await listPage.openCard(nameA);
    const detailA = new WorkspaceDetailPage(page);
    await detailA.archive();
    await detailA.closeSettings();

    // Active list should no longer contain A but still contain B.
    await listPage.goto();
    const activeAfter = await listPage.cardNames();
    expect(activeAfter.filter((n) => n === nameA)).toHaveLength(0);
    expect(activeAfter.filter((n) => n === nameB)).toHaveLength(1);

    // Archived list should contain A but not B.
    await listPage.toggleArchived();
    expect(await listPage.isShowingArchived()).toBe(true);
    const archived = await listPage.cardNames();
    expect(archived.filter((n) => n === nameA)).toHaveLength(1);
    expect(archived.filter((n) => n === nameB)).toHaveLength(0);
  });
});
