import { test, expect } from '../fixtures';
import { MemoryPage } from '../pages/MemoryPage';

/**
 * Behaviors owned by the shared Button primitive (`src/components/ui/Button.tsx`),
 * exercised through the Memory settings section, which uses every one of them.
 */
test.describe('button primitive', () => {
  test('a primary button renders a visible focus ring when focused by keyboard', async ({
    page,
  }) => {
    const memory = new MemoryPage(page);
    await memory.goto('/');
    await memory.open();
    await memory.clickAddMemory();

    // Tab from the textarea so the browser treats the focus as keyboard-driven
    // and :focus-visible applies.
    await page.locator('textarea[aria-label="New memory content"]').focus();
    await page.keyboard.press('Tab');

    const cancel = page.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeFocused();

    const outline = await cancel.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });

  test('a disabled button is not clickable and shows the disabled affordance', async ({
    page,
  }) => {
    const memory = new MemoryPage(page);
    await memory.goto('/');
    await memory.open();
    await memory.clickAddMemory();

    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await expect(save).toHaveCSS('cursor', 'not-allowed');

    // Clicking a disabled button must not submit — the form stays open.
    await save.click({ force: true });
    await expect(
      page.locator('textarea[aria-label="New memory content"]'),
    ).toBeVisible();

    await page
      .locator('textarea[aria-label="New memory content"]')
      .fill('button primitive enablement check');
    await expect(save).toBeEnabled();
  });

  test('a loading button is disabled and shows a spinner while its request is in flight', async ({
    page,
  }) => {
    const memory = new MemoryPage(page);
    await memory.goto('/');
    await memory.open();
    await memory.clickAddMemory();

    // Hold the create request open so the pending state is observable.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/memories', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await held;
      await route.fallback();
    });

    const content = `button primitive loading ${Date.now()}`;
    await page
      .locator('textarea[aria-label="New memory content"]')
      .fill(content);

    const save = page.getByRole('button', { name: 'Save' });
    await save.click();

    await expect(save).toHaveAttribute('aria-busy', 'true');
    await expect(save).toBeDisabled();
    await expect(save.locator('svg.animate-spin')).toBeVisible();

    release();
    // Once the request settles the form closes, taking the button with it.
    await expect(save).toBeHidden();

    // The row is real, DB-backed state — don't leak it into later specs.
    await memory.waitForMemory(content);
    await memory.deleteMemory(content);
  });
});
