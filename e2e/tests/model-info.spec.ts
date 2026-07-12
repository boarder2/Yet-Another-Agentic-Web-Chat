import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('Model Information popover (ModelStats v2)', () => {
  test('shows one row per model with In/Out/Total token pills', async ({
    page,
  }) => {
    const chatPage = new ChatPage(page);
    await chatPage.goto('/');
    await chatPage.sendMessage(`model-info-${Date.now()}`);
    await chatPage.waitForStreamComplete();

    const infoButton = page.getByRole('button', {
      name: 'Show model information',
    });
    await infoButton.click();

    await expect(page.getByText('Model Information')).toBeVisible();
    // The default chat/system model in tests is "test-direct" for both
    // roles — it collapses into a single per-model row (identity-only rollup).
    await expect(page.getByText('test-direct')).toBeVisible();
    await expect(page.getByText('In:', { exact: true })).toBeVisible();
    await expect(page.getByText('Out:', { exact: true })).toBeVisible();
    await expect(page.getByText('Total:', { exact: true })).toBeVisible();
    // No grand-total row — "Tokens (est)" appears exactly once (for the
    // single collapsed model row).
    await expect(page.getByText('Tokens (est)')).toHaveCount(1);
  });
});
