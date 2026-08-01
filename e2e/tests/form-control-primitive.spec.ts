import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { SettingsPage } from '../pages/SettingsPage';

/**
 * Contract owned by the shared form-control primitives (`src/components/ui/`
 * `Field.tsx`, `Input.tsx`, `Textarea.tsx`, `Select.tsx`), exercised through
 * the MCP Servers add form — the densest call site, mixing Input and Select in
 * the same Fields — plus the Memory section for Textarea.
 */

/** The recipe a control must follow: fill, radius and border weight. */
const recipe = (el: HTMLElement) => {
  const s = getComputedStyle(el);
  return {
    background: s.backgroundColor,
    radius: s.borderTopLeftRadius,
    borderWidth: s.borderTopWidth,
  };
};

/** Resolved accent color, probed the same way a control's border resolves it. */
const resolvedAccent = () => {
  const probe = document.createElement('div');
  probe.style.borderColor = 'var(--color-accent)';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).borderTopColor;
  probe.remove();
  return color;
};

/** Resolved field-fill color, probed the same way a control's fill resolves it. */
const resolvedWell = () => {
  const probe = document.createElement('div');
  probe.style.backgroundColor = 'var(--color-well)';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
};

test.describe('form control primitives', () => {
  const openAddServerForm = async (page: Page) => {
    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.openSection('MCP Servers');
    await page.getByRole('button', { name: 'Add MCP Server' }).click();
  };

  test('Input and Select share one recipe and read as an inset well on their panel', async ({
    page,
  }) => {
    await openAddServerForm(page);

    const input = page.getByLabel('Name', { exact: true });
    // Substring match: the wrapping label's text includes the selected
    // option's text, so an exact match on a Select's label never resolves.
    const select = page.getByLabel('Transport');
    await expect(input).toBeVisible();
    await expect(select).toBeVisible();

    // One recipe across the primitives — same fill, radius and border weight,
    // where the fill is the resolved bg-well midpoint token.
    const inputRecipe = await input.evaluate(recipe);
    expect(await select.evaluate(recipe)).toEqual(inputRecipe);
    expect(inputRecipe.background).toBe(await page.evaluate(resolvedWell));

    // The field must not be the same colour as the card it sits on, or only
    // its border delineates it.
    const panel = await input.evaluate((el) => {
      const card = el.closest('.bg-surface');
      return card ? getComputedStyle(card).backgroundColor : null;
    });
    expect(panel).not.toBeNull();
    expect(inputRecipe.background).not.toBe(panel);
  });

  test('focusing a control flips its border to accent in place', async ({
    page,
  }) => {
    await openAddServerForm(page);

    const input = page.getByLabel('Name', { exact: true });
    const accent = await page.evaluate(resolvedAccent);

    const resting = await input.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.borderTopColor, width: s.borderTopWidth };
    });
    await input.focus();

    // 1px accent, in place — nothing reflows, and no ring is drawn on top.
    await expect
      .poll(() => input.evaluate((el) => getComputedStyle(el).borderTopColor))
      .toBe(accent);
    expect(
      await input.evaluate((el) => getComputedStyle(el).borderTopWidth),
    ).toBe(resting.width);
    expect(
      await input.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe('none');
  });

  test('focusing a Textarea flips its border too', async ({ page }) => {
    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.openSection('Memory');
    await page.getByRole('button', { name: 'Add memory' }).click();

    const textarea = page.locator('textarea[aria-label="New memory content"]');
    await textarea.focus();
    await expect
      .poll(() =>
        textarea.evaluate((el) => getComputedStyle(el).borderTopColor),
      )
      .toBe(await page.evaluate(resolvedAccent));
  });

  test("a Field's visible label is the accessible name and focuses the control", async ({
    page,
  }) => {
    await openAddServerForm(page);

    // getByLabel resolves through Field's wrapping <label>, with no aria-label
    // shadowing it — the visible text *is* the accessible name.
    const input = page.getByLabel('URL', { exact: true });
    await expect(input).toBeVisible();
    expect(await input.getAttribute('aria-label')).toBeNull();

    await page.getByText('URL', { exact: true }).click();
    await expect(input).toBeFocused();
  });

  test('the chat composer follows the recipe: inset well on its surface, accent border on focus', async ({
    page,
  }) => {
    await page.goto('/');
    const composer = page.getByPlaceholder(
      'What would you like to learn today?',
    );
    await expect(composer).toBeFocused();

    // The composer field uses the bg-well fill — resolved to the midpoint
    // token, distinct from the bg-surface card it sits in.
    expect(
      await composer.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(await page.evaluate(resolvedWell));

    // Focus flips the border to accent, in place.
    await expect
      .poll(() =>
        composer.evaluate((el) => getComputedStyle(el).borderTopColor),
      )
      .toBe(await page.evaluate(resolvedAccent));
  });
});
