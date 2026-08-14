import { test, expect } from '../fixtures';
import { seedArtifact, seedGeneratedImage, seedWorkspace } from '../utils/seed';
import { uniq } from '../utils/helpers';

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/**
 * The history item whose title matches, scoping assertions to one artifact.
 * Matched exactly: the shared test DB accumulates artifacts across specs, and
 * an item's meta can carry the chat title, which repeats the artifact title.
 */
function artifactRow(page: import('@playwright/test').Page, title: string) {
  return page
    .locator('[data-list-row], [data-testid="generated-image-history-card"]')
    .filter({
      has: page.locator(
        '[data-list-row-title], [data-testid="generated-image-title"]',
        { hasText: new RegExp(`^${title}$`) },
      ),
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

  test('type filters preserve compact lists and switch Images to the gallery', async ({
    page,
    request,
  }) => {
    const pageTitle = uniq('Filter page');
    const imagePrompt = uniq('Filter image prompt');
    await seedArtifact(request, { title: pageTitle });
    const image = await seedGeneratedImage(request, { prompt: imagePrompt });
    const imageUrl = `/api/uploads/images/${image.id}`;
    const pageRow = artifactRow(page, pageTitle);
    const imageRow = artifactRow(page, imagePrompt);

    await page.goto('/history?tab=artifacts');
    await waitForDataLoaded(page);

    await expect(page.getByTestId('artifact-type-all')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pageRow).toBeVisible();
    await expect(imageRow).toBeVisible();
    await expect(
      imageRow.getByTestId('generated-image-thumbnail'),
    ).toHaveAttribute('src', imageUrl);
    await expect(imageRow).toHaveAttribute('data-list-row');
    await expect(page.getByTestId('generated-image-gallery')).toHaveCount(0);

    await page.getByTestId('artifact-type-pages').click();
    await expect(page).toHaveURL(/[?&]type=pages(?:&|$)/);
    await expect(page.getByTestId('artifact-type-pages')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pageRow).toBeVisible();
    await expect(imageRow).toBeHidden();
    await expect(page.getByTestId('generated-image-gallery')).toHaveCount(0);

    await page.getByTestId('artifact-type-images').click();
    await expect(page).toHaveURL(/[?&]type=images(?:&|$)/);
    await expect(page.getByTestId('artifact-type-images')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pageRow).toBeHidden();
    await expect(imageRow).toBeVisible();
    await expect(page.getByTestId('generated-image-gallery')).toBeVisible();
    await expect(imageRow.getByTestId('generated-image-stage')).toHaveClass(
      /aspect-square/,
    );
    await expect(
      imageRow.getByTestId('generated-image-unavailable'),
    ).toBeVisible();
    await expect(
      imageRow.getByRole('img', { name: 'Image unavailable' }),
    ).toBeVisible();
    await expect(imageRow.getByTestId('generated-image-title')).toHaveText(
      imagePrompt,
    );

    // The selected type is URL-backed, so a reload must restore the Images view.
    await page.reload();
    await expect(page.getByTestId('artifact-type-images')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(imageRow).toBeVisible();

    // Type choices are navigations, so back/forward restores each filtered view.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]type=pages(?:&|$)/);
    await expect(page.getByTestId('artifact-type-pages')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pageRow).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/[?&]type=images(?:&|$)/);
    await expect(page.getByTestId('artifact-type-images')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(imageRow).toBeVisible();
  });

  test('Images use a responsive gallery with complete framing and provenance', async ({
    page,
    request,
  }) => {
    const workspaceName = uniq('Gallery workspace');
    const workspaceId = await seedWorkspace(request, { name: workspaceName });
    const prompts = [
      uniq('Gallery image one'),
      uniq('Gallery image two'),
      uniq('Gallery image three'),
    ];
    const images = await Promise.all(
      prompts.map((prompt) =>
        seedGeneratedImage(request, { workspaceId, prompt }),
      ),
    );
    const chatTitle = uniq('Gallery originating chat');
    expect(
      (
        await request.patch(`/api/chats/${images[0].chatId}`, {
          data: { title: chatTitle },
        })
      ).status(),
    ).toBe(200);

    for (const image of images) {
      await page.route(`**/api/uploads/images/${image.id}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: VALID_PNG,
        }),
      );
    }

    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/history?tab=artifacts&type=images');
    await waitForDataLoaded(page);
    await page
      .getByRole('button', { name: workspaceName, exact: true })
      .click();

    const gallery = page.getByTestId('generated-image-gallery');
    await expect(gallery).toBeVisible();
    await expect(page.getByTestId('generated-image-history-card')).toHaveCount(
      3,
    );

    const firstItem = artifactRow(page, prompts[0]);
    await expect(firstItem.getByTestId('generated-image-stage')).toHaveClass(
      /aspect-square/,
    );
    await expect(firstItem.getByTestId('generated-image-title')).toHaveClass(
      /truncate/,
    );
    await expect(firstItem.locator('img')).toHaveAttribute('loading', 'lazy');
    await expect(firstItem.locator('img')).toHaveClass(/object-contain/);
    await expect(firstItem.locator('img')).toBeVisible();
    await expect(firstItem.locator('time')).toBeVisible();
    await expect(firstItem.getByText(chatTitle, { exact: true })).toBeVisible();
    await expect(
      firstItem.getByRole('link', { name: workspaceName }),
    ).toHaveAttribute('href', `/workspaces/${workspaceId}`);

    const columnCount = () =>
      gallery.evaluate(
        (element) =>
          getComputedStyle(element)
            .gridTemplateColumns.trim()
            .split(/\s+/)
            .filter(Boolean).length,
      );
    await expect.poll(columnCount).toBe(1);

    await page.setViewportSize({ width: 800, height: 900 });
    await expect.poll(columnCount).toBe(2);

    await page.setViewportSize({ width: 1200, height: 900 });
    await expect.poll(columnCount).toBe(3);
  });

  test('workspace image preview shows prompt, provenance, timestamp, download, and missing-chat state', async ({
    page,
    request,
  }) => {
    const workspaceName = uniq('Preview workspace');
    const workspaceId = await seedWorkspace(request, { name: workspaceName });
    const prompt = `Full preview prompt ${uniq('with all details')}`;
    const image = await seedGeneratedImage(request, {
      workspaceId,
      prompt,
    });
    const chatResponse = await request.get(`/api/chats/${image.chatId}`);
    expect(chatResponse.status()).toBe(200);
    const chatTitle = (
      (await chatResponse.json()) as { chat: { title: string } }
    ).chat.title;

    await page.goto('/history?tab=artifacts&type=images');
    await waitForDataLoaded(page);

    const imageRow = artifactRow(page, prompt);
    await expect(imageRow).toBeVisible();
    await imageRow.focus();
    await imageRow.press('Enter');

    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('generated-image-prompt')).toHaveText(
      prompt,
    );
    await expect(dialog.locator('time')).toHaveAttribute(
      'datetime',
      image.createdAt.toISOString(),
    );
    await expect(
      dialog.getByRole('link', { name: workspaceName }),
    ).toHaveAttribute('href', `/workspaces/${workspaceId}`);
    await expect(dialog.getByRole('link', { name: chatTitle })).toHaveAttribute(
      'href',
      `/workspaces/${workspaceId}/c/${image.chatId}`,
    );

    const download = dialog.getByRole('link', { name: 'Download image' });
    await expect(download).toHaveAttribute(
      'href',
      `/api/uploads/images/${image.id}`,
    );
    await expect(download).toHaveAttribute(
      'download',
      `generated-image-${image.id}.${image.extension}`,
    );

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await imageRow.focus();
    await imageRow.press(' ');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    // Keyboard events from the nested workspace link must not be mistaken for
    // activation of the image row itself.
    const workspaceLink = imageRow.getByRole('link', { name: workspaceName });
    await workspaceLink.focus();
    await workspaceLink.press('Space');
    await expect(dialog).toBeHidden();

    // Pointer activation of the nested workspace link navigates without opening
    // the card preview.
    await workspaceLink.click();
    await expect(page).toHaveURL(`/workspaces/${workspaceId}`);
    await expect(dialog).toBeHidden();
    await page.goto('/history?tab=artifacts&type=images');
    await waitForDataLoaded(page);
    await expect(artifactRow(page, prompt)).toBeVisible();

    // Workspace-owned images survive chat deletion but lose their originating
    // chat, so the preview must not offer a stale conversation link.
    expect((await request.delete(`/api/chats/${image.chatId}`)).status()).toBe(
      200,
    );
    await page.reload();
    await expect(artifactRow(page, prompt)).toBeVisible();
    await artifactRow(page, prompt).click();

    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByTestId('generated-image-chat-unavailable'),
    ).toBeVisible();
    await expect(
      dialog.locator(`a[href="/workspaces/${workspaceId}/c/${image.chatId}"]`),
    ).toHaveCount(0);
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

  test('"open in new tab" affordance opens the raw artifact', async ({
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
      .getByRole('link', { name: 'Open in a new tab' })
      .click();

    const newTab = await newTabPromise;
    await expect(newTab).toHaveURL(`/api/artifacts/${artifactId}/raw`);
  });
});
