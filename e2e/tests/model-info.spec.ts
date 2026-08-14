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

  test('message footer actions expose IconButton names and reserved focus geometry', async ({
    page,
  }) => {
    const chatPage = new ChatPage(page);
    await chatPage.goto('/');
    await chatPage.sendMessage(`message-footer-icons-${Date.now()}`);
    await chatPage.waitForStreamComplete();

    for (const name of [
      'Show model information',
      'Copy response',
      'Read aloud',
    ]) {
      const action = page.getByRole('button', { name, exact: true });
      await expect(action).toBeVisible();
      await expect(action).toHaveAttribute('title', name);
      await expect(action).toHaveClass(/focus-border-neutral/);
      await expect(action).toHaveCSS('border-top-width', '1px');
      await expect(action.locator('svg')).toHaveAttribute('width', '15');
      await expect(action.locator('svg')).toHaveAttribute('height', '15');
    }

    const rewrite = page.getByRole('button', { name: 'Rewrite', exact: true });
    await expect(rewrite).toBeVisible();
    await expect(rewrite).toContainText('Rewrite');
    await expect(rewrite).toHaveClass(/focus-border-neutral/);
    await expect(rewrite).toHaveCSS('border-top-width', '1px');

    const before = await page
      .getByRole('button', { name: 'Show model information', exact: true })
      .boundingBox();
    expect(before).not.toBeNull();

    // Rewrite precedes the model-information action in the footer. A real Tab
    // traversal proves the shared border is the visible keyboard treatment.
    await rewrite.focus();
    await page.keyboard.press('Tab');
    const info = page.getByRole('button', {
      name: 'Show model information',
      exact: true,
    });
    await expect(info).toBeFocused();
    const accent = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.border = '1px solid var(--color-accent)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return color;
    });
    await expect
      .poll(() => info.evaluate((el) => getComputedStyle(el).borderTopColor))
      .toBe(accent);
    await expect(info).toHaveCSS('border-top-width', '1px');
    await expect(info).toHaveCSS('outline-style', 'none');
    expect(await info.boundingBox()).toEqual(before);
  });
});
