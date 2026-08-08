import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';
import type { APIRequestContext } from '@playwright/test';

const DOC =
  '<!doctype html><html><head><title>Live</title></head><body><h1 id="hd">Live Report</h1></body></html>';

test.describe('artifact panel during a live run', () => {
  // Switching the composer's chat model writes an instance-wide, DB-synced
  // setting, so this lives in the single-worker `serial` project and resets
  // afterwards (see e2e/CLAUDE.md).
  test.afterEach(async ({ request }) => {
    await request.patch('/api/settings', {
      data: { chatModelProvider: 'test', chatModel: 'test-direct' },
    });
  });

  /** Select the composer model through the DB, which is its source of truth. */
  async function useArtifactModel(request: APIRequestContext) {
    await request.patch('/api/settings', {
      data: { chatModelProvider: 'test', chatModel: 'test-artifact' },
    });
  }

  test('the panel opens by itself as soon as the agent writes the artifact', async ({
    page,
    request,
  }) => {
    await useArtifactModel(request);
    const chat = new ChatPage(page);
    await chat.goto('/');

    await expect(page.getByTestId('artifact-panel')).toBeHidden();
    await chat.sendMessage(`Live Report|${DOC}`);

    const panel = page.getByTestId('artifact-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('artifact-title')).toHaveText('Live Report');
    await expect(
      page.frameLocator('[data-testid="artifact-frame"]').locator('#hd'),
    ).toHaveText('Live Report');

    await chat.waitForStreamComplete();
    // The transcript keeps its own re-entry point once the run finishes.
    await expect(page.getByTestId('artifact-card')).toBeVisible();
  });

  test('reloading a finished run leaves the panel closed', async ({
    page,
    request,
  }) => {
    await useArtifactModel(request);
    const chat = new ChatPage(page);
    await chat.goto('/');
    await chat.sendMessage(`Reload Report|${DOC}`);
    await expect(page.getByTestId('artifact-panel')).toBeVisible();
    await chat.waitForStreamComplete();

    await page.reload();

    // Reconnecting to a finished run must not pop the viewer; the card is the
    // way back in.
    await expect(page.getByTestId('artifact-card')).toBeVisible();
    await expect(page.getByTestId('artifact-panel')).toBeHidden();
  });
});
