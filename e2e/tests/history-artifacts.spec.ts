import { test, expect } from '../fixtures';
import { seedArtifact, seedWorkspace } from '../utils/seed';
import { uniq } from '../utils/helpers';

/** Wait for both the artifact list and workspace list queries to finish. */
async function waitForDataLoaded(page: import('@playwright/test').Page) {
  // Artifact loading spinner.
  await expect(page.locator('.animate-spin')).toHaveCount(0, {
    timeout: 10_000,
  });
  // Workspace filter chips are conditional on activeWorkspaces.length > 0;
  // wait until at least the "All" chip appears when we've seeded a workspace,
  // or a reasonable fallback.
  await page.waitForFunction(
    () => {
      const body = document.body.textContent ?? '';
      // The "All" chip indicates workspace data has loaded (workspaces present).
      // When no workspace exists at all, "No artifacts yet." means the loaded
      // artifact browser rendered with zero results.
      return body.includes('All') || body.includes('No artifacts yet.');
    },
    { timeout: 10_000 },
  );
}

test.describe('history: artifact tab', () => {
  test('the tab bar shows both tabs, defaulting to Conversations', async ({
    page,
  }) => {
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(
      page.getByRole('tablist').locator('a[aria-current="page"]'),
    ).toContainText('Conversations');
    await expect(page.getByRole('tablist')).toContainText('Artifacts');
  });

  test('?tab=artifacts renders the artifact browser', async ({
    page,
    request,
  }) => {
    // Use a workspace filter to isolate from shared-DB artifacts.
    const wsName = uniq('Empty WS');
    await seedWorkspace(request, { name: wsName });
    await page.goto('/history?tab=artifacts');
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

    // Click the empty workspace chip — no artifacts live there.
    await page.getByRole('button', { name: wsName }).click();
    await expect(page.getByText('No artifacts yet.')).toBeVisible();
  });

  test('lists artifacts across scopes with provenance', async ({
    page,
    request,
  }) => {
    const wsName = uniq('Provenance WS');
    const ws = await seedWorkspace(request, { name: wsName });
    await seedArtifact(request, {
      title: 'Workspace Doc',
      workspaceId: ws,
    });
    await seedArtifact(request, { title: 'Scoped Doc' });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    // Role-based locator with regex matches the title <button> uniquely even
    // though its accessible name includes the full meta + chatTitle text.
    await expect(
      page.getByRole('button', { name: /Workspace Doc/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Scoped Doc/ }),
    ).toBeVisible();

    // Workspace chip renders for the owned artifact. The filter-chip button at
    // the top also matches the same text, so use getByTitle (the row chip has
    // title={ws.name}) to uniquely target the artifact-row chip.
    await expect(page.getByTitle(wsName)).toBeVisible();
  });

  test('workspace filter chips filter the list', async ({ page, request }) => {
    const ws = await seedWorkspace(request, { name: uniq('Filter WS') });
    await seedArtifact(request, {
      title: 'Filtered Doc',
      workspaceId: ws,
    });
    await seedArtifact(request, { title: 'Unfiltered Doc' });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    // Both visible before filtering.
    await expect(
      page.getByRole('button', { name: /Filtered Doc/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Unfiltered Doc/ }),
    ).toBeVisible();

    // Filter to "No workspace" only (chat-scoped).
    await page.getByRole('button', { name: 'No workspace' }).click();
    await expect(
      page.getByRole('button', { name: /Unfiltered Doc/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Filtered Doc/ }),
    ).toBeHidden();
  });

  test('clicking a row navigates to the chat with ?artifact=', async ({
    page,
    request,
  }) => {
    const { chatId, artifactId } = await seedArtifact(request, {
      title: 'Navigate Me',
    });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    await page.getByRole('button', { name: /Navigate Me/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/c/${chatId}\\?artifact=${artifactId}`),
    );
    // The artifact panel mounts once the chat loads.
    await expect(page.getByTestId('artifact-panel')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('"open in new tab" affordance opens the raw document', async ({
    page,
    request,
  }) => {
    const { artifactId } = await seedArtifact(request, {
      title: 'Open Me Tab',
    });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    const newTabPromise = page.waitForEvent('popup');

    // Scope the click to the seeded artifact's row by traversing up from the
    // title button, so we never hit a different row's affordance.
    const titleBtn = page.getByRole('button', { name: /Open Me Tab/ });
    const row = titleBtn.locator('xpath=..');
    await row.getByRole('button', { name: 'Open in a new tab' }).click();

    const newTab = await newTabPromise;
    await expect(newTab).toHaveURL(`/api/artifacts/${artifactId}/raw`);
  });
});
