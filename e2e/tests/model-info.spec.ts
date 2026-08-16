import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('Model Information popover (ModelStats v2)', () => {
  test('one assistant message footer exposes model info, edit, Tab traversal, and read-aloud loading', async ({
    page,
  }) => {
    // Installed before the turn so it is armed well ahead of the Read-aloud
    // step, without affecting any earlier assertion (nothing else in this
    // turn calls /api/tts).
    let release = () => {};
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/tts', async (route) => {
      requestStarted();
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'e2e-tts-loading' }),
      });
    });

    const chatPage = new ChatPage(page);
    await chatPage.goto('/');
    await chatPage.sendMessage(`model-info-${Date.now()}`);
    await chatPage.waitForStreamComplete();

    await test.step('message footer actions expose IconButton names and reserved focus geometry', async () => {
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

      const rewrite = page.getByRole('button', {
        name: 'Rewrite',
        exact: true,
      });
      await expect(rewrite).toBeVisible();
      await expect(rewrite).toContainText('Rewrite');
      await expect(rewrite).toHaveClass(/focus-border-neutral/);
      await expect(rewrite).toHaveCSS('border-top-width', '1px');

      // Edit round trip.
      const edit = page.getByRole('button', {
        name: 'Edit message',
        exact: true,
      });
      await expect(edit).toBeVisible();
      await expect(edit).toHaveAttribute('title', 'Edit message');
      await expect(edit).toHaveClass(/focus-border-neutral/);
      await expect(edit.locator('svg')).toHaveAttribute('width', '15');
      await edit.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('button', { name: 'Cancel editing', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(edit).toBeVisible();

      const before = await page
        .getByRole('button', { name: 'Show model information', exact: true })
        .boundingBox();
      expect(before).not.toBeNull();

      // Rewrite precedes the model-information action in the footer. A real
      // Tab traversal proves the shared border is the visible keyboard
      // treatment.
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

    await test.step('shows one row per model with In/Out/Total token pills', async () => {
      const infoButton = page.getByRole('button', {
        name: 'Show model information',
      });
      await infoButton.click();

      await expect(page.getByText('Model Information')).toBeVisible();
      // The default chat/system model in tests is "test-direct" for both
      // roles — it collapses into a single per-model row (identity-only
      // rollup).
      await expect(page.getByText('test-direct')).toBeVisible();
      await expect(page.getByText('In:', { exact: true })).toBeVisible();
      await expect(page.getByText('Out:', { exact: true })).toBeVisible();
      await expect(page.getByText('Total:', { exact: true })).toBeVisible();
      // No grand-total row — "Tokens (est)" appears exactly once (for the
      // single collapsed model row).
      await expect(page.getByText('Tokens (est)')).toHaveCount(1);

      await page.keyboard.press('Escape');
    });

    // Last: leaves a held /api/tts request, released in `finally`.
    await test.step('Read aloud exposes IconButton loading semantics while TTS prepares', async () => {
      try {
        const read = page.getByRole('button', {
          name: 'Read aloud',
          exact: true,
        });
        await read.focus();
        await page.keyboard.press('Enter');
        await started;

        const stop = page.getByRole('button', { name: 'Stop', exact: true });
        await expect(stop).toBeDisabled();
        await expect(stop).toHaveAttribute('aria-busy', 'true');
        await expect(stop).toHaveAttribute('title', 'Stop');
        await expect(stop.locator('svg.animate-spin')).toHaveAttribute(
          'width',
          '15',
        );
        await expect(stop.locator('svg.animate-spin')).toHaveAttribute(
          'height',
          '15',
        );
      } finally {
        release();
      }
    });
  });
});
