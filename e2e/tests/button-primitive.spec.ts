import { test, expect } from '../fixtures';
import { MemoryPage } from '../pages/MemoryPage';

/**
 * Behaviors owned by the shared Button primitive (`src/components/ui/Button.tsx`),
 * exercised through the Memory settings section, which uses every one of them.
 */
test.describe('button primitive', () => {
  test('a neutral button uses a 1px in-place accent focus border', async ({
    page,
  }) => {
    const memory = new MemoryPage(page);
    await memory.goto('/');
    await memory.open();
    await memory.clickAddMemory();

    const textarea = page.locator('textarea[aria-label="New memory content"]');
    const cancel = page.getByRole('button', { name: 'Cancel' });
    const before = await cancel.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
        outlineStyle: style.outlineStyle,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });

    // Tab from the textarea so the browser treats the focus as keyboard-driven
    // and :focus-visible applies.
    await textarea.focus();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();

    const accent = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.border = '1px solid var(--color-accent)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return color;
    });
    await expect
      .poll(() => cancel.evaluate((el) => getComputedStyle(el).borderTopColor))
      .toBe(accent);
    const after = await cancel.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
        outlineStyle: style.outlineStyle,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });

    expect(before.borderWidth).toBe('1px');
    expect(after.borderWidth).toBe('1px');
    expect(after.borderColor).toBe(accent);
    expect(after.outlineStyle).toBe('none');
    expect(after.rect).toEqual(before.rect);
  });

  test('a primary button keeps contrast text and focus without reflow', async ({
    page,
  }) => {
    const memory = new MemoryPage(page);
    await memory.goto('/');
    await memory.open();
    await memory.clickAddMemory();

    const textarea = page.locator('textarea[aria-label="New memory content"]');
    await textarea.fill('primary focus contrast check');
    const cancel = page.getByRole('button', { name: 'Cancel' });
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeEnabled();

    const contrastForeground = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'text-accent-fg';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect
      .poll(() => save.evaluate((el) => getComputedStyle(el).color))
      .toBe(contrastForeground);

    const before = await save.boundingBox();
    expect(before).not.toBeNull();

    // The second Tab lands on the enabled primary action.
    await textarea.focus();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(save).toBeFocused();
    await save.hover();

    await expect
      .poll(() => save.evaluate((el) => getComputedStyle(el).borderTopColor))
      .toBe(contrastForeground);
    const after = await save.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        color: style.color,
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
        outlineStyle: style.outlineStyle,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
    expect(after.color).toBe(contrastForeground);
    expect(after.borderWidth).toBe('1px');
    expect(after.borderColor).toBe(after.color);
    expect(after.outlineStyle).toBe('none');
    expect(after.rect).toEqual(before);
  });

  test('modal close exposes the IconButton accessible name and 15px icon', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Settings').first().click();

    const close = page.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeVisible();
    await expect(close).toHaveAttribute('title', 'Close');
    await expect(close).toHaveClass(/focus-border-neutral/);
    await expect(close).toHaveCSS('border-top-width', '1px');
    await expect(close.locator('svg')).toHaveAttribute('width', '15');
    await expect(close.locator('svg')).toHaveAttribute('height', '15');

    await close.click();
    await expect(close).toBeHidden();
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
