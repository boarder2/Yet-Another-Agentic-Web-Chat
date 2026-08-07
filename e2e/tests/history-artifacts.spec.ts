import { test, expect } from '../fixtures';
import { seedArtifact, seedWorkspace } from '../utils/seed';
import { uniq } from '../utils/helpers';

/**
 * The list row whose title matches, scoping assertions to one artifact. Matched
 * exactly: the shared test DB accumulates artifacts across specs, and a row's
 * meta carries the chat title, which repeats the artifact title.
 */
function artifactRow(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-list-row]').filter({
    has: page.locator('[data-list-row-title]', {
      hasText: new RegExp(`^${title}$`),
    }),
  });
}

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
    const wsDoc = uniq('Workspace Doc');
    const scopedDoc = uniq('Scoped Doc');
    await seedArtifact(request, { title: wsDoc, workspaceId: ws });
    await seedArtifact(request, { title: scopedDoc });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    await expect(artifactRow(page, wsDoc)).toBeVisible();
    await expect(artifactRow(page, scopedDoc)).toBeVisible();

    // Workspace chip renders for the owned artifact. The filter chip at the top
    // carries the same text, so scope the assertion to the artifact's own row.
    await expect(
      artifactRow(page, wsDoc).getByRole('link', { name: wsName }),
    ).toBeVisible();
  });

  test('workspace filter chips filter the list', async ({ page, request }) => {
    const ws = await seedWorkspace(request, { name: uniq('Filter WS') });
    const filtered = uniq('Filtered Doc');
    const unfiltered = uniq('Unfiltered Doc');
    await seedArtifact(request, { title: filtered, workspaceId: ws });
    await seedArtifact(request, { title: unfiltered });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    // Both visible before filtering.
    await expect(artifactRow(page, filtered)).toBeVisible();
    await expect(artifactRow(page, unfiltered)).toBeVisible();

    // Filter to "No workspace" only (chat-scoped).
    await page.getByRole('button', { name: 'No workspace' }).click();
    await expect(artifactRow(page, unfiltered)).toBeVisible();
    await expect(artifactRow(page, filtered)).toBeHidden();
  });

  test('clicking a row navigates to the chat with ?artifact=', async ({
    page,
    request,
  }) => {
    const title = uniq('Navigate Me');
    const { chatId, artifactId } = await seedArtifact(request, { title });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    await artifactRow(page, title).locator('[data-list-row-title]').click();
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
    const title = uniq('Open Me Tab');
    const { artifactId } = await seedArtifact(request, { title });

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    const newTabPromise = page.waitForEvent('popup');

    // Scope the click to the seeded artifact's row so we never hit a different
    // row's affordance.
    await artifactRow(page, title)
      .getByRole('button', { name: 'Open in a new tab' })
      .click();

    const newTab = await newTabPromise;
    await expect(newTab).toHaveURL(`/api/artifacts/${artifactId}/raw`);
  });
});
