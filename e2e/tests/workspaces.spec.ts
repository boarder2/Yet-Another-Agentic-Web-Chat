import { test, expect } from '../fixtures';
import { seedWorkspace } from '../utils/seed';
import { WorkspacesPage } from '../pages/WorkspacesPage';
import { WorkspaceDetailPage } from '../pages/WorkspaceDetailPage';

const FILE_NAME = 'notes.md';

test.describe('workspaces CRUD', () => {
  test('create a workspace via UI, rename it, add and remove a file, archive and unarchive', async ({
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

  test('creating a workspace with "Use custom models" enabled pins the model at creation', async ({
    page,
    request,
  }) => {
    const listPage = new WorkspacesPage(page);
    await listPage.goto();

    const wsId = await listPage.createWorkspaceWithCustomModels(
      `ws-create-pin-${Date.now()}`,
    );

    // The pin is persisted at creation (pre-filled from the current global
    // selection — test/test-direct, the seeded e2e default), not left null.
    await expect
      .poll(async () => {
        const res = await request.get(`/api/workspaces/${wsId}`);
        return (await res.json()).workspace.modelOverride;
      })
      .toMatchObject({
        chatProvider: 'test',
        chatModel: 'test-direct',
        systemProvider: 'test',
        systemModel: 'test-direct',
      });
  });

  test('toggling "Use custom models" pins then clears the workspace model override', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: `ws-model-override-${Date.now()}`,
    });

    const detailPage = new WorkspaceDetailPage(page);
    await detailPage.goto(wsId);

    // No override to start.
    const initial = await request.get(`/api/workspaces/${wsId}`);
    expect((await initial.json()).workspace.modelOverride ?? null).toBeNull();

    // Enabling pre-fills from the current global selection (test/test-direct,
    // the seeded e2e default — see e2e/serial/model-picker.spec.ts) and PATCHes
    // immediately.
    await detailPage.toggleCustomModels();
    await detailPage.closeSettings();

    await expect
      .poll(async () => {
        const res = await request.get(`/api/workspaces/${wsId}`);
        return (await res.json()).workspace.modelOverride;
      })
      .toMatchObject({
        chatProvider: 'test',
        chatModel: 'test-direct',
        systemProvider: 'test',
        systemModel: 'test-direct',
      });

    // Disabling clears the override immediately.
    await detailPage.toggleCustomModels();
    await detailPage.closeSettings();

    await expect
      .poll(async () => {
        const res = await request.get(`/api/workspaces/${wsId}`);
        return (await res.json()).workspace.modelOverride ?? null;
      })
      .toBeNull();
  });

  test('uses the page loading state and preserves active versus archived empty copy', async ({
    page,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });

    await page.route('**/api/workspaces**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== '/api/workspaces') {
        await route.fallback();
        return;
      }
      if (!url.searchParams.has('archived')) {
        requestStarted();
        await held;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workspaces: [] }),
      });
    });

    await page.goto('/workspaces');
    await expect(
      page.getByRole('heading', { name: 'Workspaces', exact: true }),
    ).toBeVisible();
    await started;

    const loading = page.locator(
      '[data-list-state="loading"][data-list-layout="page"]',
    );
    await expect(loading).toBeVisible();
    await expect(loading.locator('svg')).toHaveAttribute('width', '24');
    await expect(loading.locator('svg')).toHaveAttribute('height', '24');

    release();
    await expect(loading).toBeHidden();

    let empty = page.locator(
      '[data-list-state="empty"][data-list-layout="page"]',
    );
    await expect(empty).toBeVisible();
    await expect(
      empty.getByRole('heading', { name: 'No workspaces yet', exact: true }),
    ).toBeVisible();
    await expect(
      empty.getByText(
        'Workspaces let you organize chats, files, and instructions for specific projects.',
        { exact: true },
      ),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    empty = page.locator('[data-list-state="empty"][data-list-layout="page"]');
    await expect(
      empty.getByRole('heading', {
        name: 'No archived workspaces',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      empty.getByText(
        'Workspaces let you organize chats, files, and instructions for specific projects.',
        { exact: true },
      ),
    ).toHaveCount(0);
  });

  test('uses section and compact states for empty workspace panels', async ({
    page,
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: `ws-state-layout-${Date.now()}`,
    });

    try {
      await page.setViewportSize({ width: 375, height: 800 });
      let releaseFiles!: () => void;
      const heldFiles = new Promise<void>((resolve) => {
        releaseFiles = resolve;
      });
      let filesRequestStarted!: () => void;
      const filesStarted = new Promise<void>((resolve) => {
        filesRequestStarted = resolve;
      });

      await page.route('**/api/workspaces/**/files', async (route) => {
        const url = new URL(route.request().url());
        if (
          url.pathname === `/api/workspaces/${workspaceId}/files` &&
          route.request().method() === 'GET'
        ) {
          filesRequestStarted();
          await heldFiles;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ files: [] }),
          });
          return;
        }
        await route.fallback();
      });
      await page.route('**/api/memories**', async (route) => {
        const url = new URL(route.request().url());
        if (
          url.pathname === '/api/memories' &&
          url.searchParams.get('workspaceId') === workspaceId
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: [], total: 0 }),
          });
          return;
        }
        await route.fallback();
      });

      await page.goto(`/workspaces/${workspaceId}`);
      await expect(
        page.getByRole('heading', { name: /ws-state-layout/ }),
      ).toBeVisible();
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await filesStarted;

      const loading = page.locator(
        '[data-list-state="loading"][data-list-layout="section"]',
      );
      await expect(loading).toBeVisible();
      await expect(loading.locator('svg')).toHaveAttribute('width', '20');
      await expect(loading.locator('svg')).toHaveAttribute('height', '20');

      releaseFiles();
      await expect(loading).toBeHidden();
      let empty = page.locator(
        '[data-list-state="empty"][data-list-layout="section"]',
      );
      await expect(
        empty.getByRole('heading', { name: 'No files yet.' }),
      ).toBeVisible();

      await page.getByRole('tab', { name: 'Memory', exact: true }).click();
      empty = page.locator(
        '[data-list-state="empty"][data-list-layout="section"]',
      );
      await expect(
        empty.getByRole('heading', { name: 'No workspace memories yet.' }),
      ).toBeVisible();

      // The empty instructions branch immediately opens the editor (so users
      // can start typing), while InstructionsEditor still owns the section
      // empty state for its read-only path. Verify the public empty-panel
      // states here; the editor's editable seam is covered by the existing
      // workspace-instructions flow.
    } finally {
      const response = await request.delete(`/api/workspaces/${workspaceId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });

  test('uses a compact artifact empty state in the desktop workspace sidebar', async ({
    page,
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: `ws-sidebar-state-${Date.now()}`,
    });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.route('**/api/artifacts**', async (route) => {
        const url = new URL(route.request().url());
        if (
          url.pathname === '/api/artifacts' &&
          url.searchParams.get('workspaceId') === workspaceId
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          });
          return;
        }
        await route.fallback();
      });

      await page.goto(`/workspaces/${workspaceId}`);
      const artifacts = page.getByRole('button', { name: /Artifacts/ }).last();
      await expect(artifacts).toBeVisible();
      await artifacts.click();

      const empty = page.locator(
        '[data-list-state="empty"][data-list-layout="compact"]',
      );
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(
        'No artifacts yet. Ask a chat in this workspace to build one.',
      );
    } finally {
      const response = await request.delete(`/api/workspaces/${workspaceId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });
});
