import { test, expect } from '../fixtures';

/**
 * Verify the `test` provider and its models are listed in the chat model picker
 * and that the seeded test model (`test-direct`) is the current default chat
 * selection.
 *
 * The canonical chat/system model picker is the composer's ModelConfigurator on
 * the home page (Settings explicitly defers to "the chat input's model picker").
 * With no presets configured it renders a "Configure models" button that opens
 * the Model Configuration dialog containing the grouped ModelField popover.
 */

test.describe('model picker', () => {
  // Asserts the seeded default chat/system model — a concurrently-running
  // spec that switches the model mid-run would otherwise legitimately (via
  // DB sync) change what this spec observes. This spec's `serial` project
  // (one worker) rules that out.

  test('test provider and models are listed in Chat Model picker, with test-direct as the default', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#message-input').waitFor({ state: 'visible' });

    // Open the composer's model configurator dialog.
    await page.getByRole('button', { name: 'Configure models' }).click();
    await expect(
      page.getByRole('heading', { name: 'Model Configuration' }),
    ).toBeVisible();

    // Open the Chat Model grouped picker (the first ModelField — the Cpu button).
    const dialog = page.getByRole('dialog');
    await dialog.locator('button:has(svg.lucide-cpu)').first().click();

    // The ModelField popover panel: uniquely the overflow-hidden + shadow-raised
    // container (the dialog panel shares shadow-raised but isn't overflow-hidden).
    const popover = page.locator('div.overflow-hidden.shadow-raised').first();
    await expect(popover.locator('h3')).toHaveText('Select Chat Model');

    // The seeded default chat model is test/test-direct, so the Test provider is
    // pre-expanded and marked active, exposing its two models.
    await expect(popover.getByText('(active)')).toBeVisible();
    await expect(
      popover.locator('span.font-medium', { hasText: 'Test (direct)' }),
    ).toBeVisible();
    await expect(
      popover.locator('span.font-medium', { hasText: 'Test (tool loop)' }),
    ).toBeVisible();

    // test-direct (the default) carries the Active badge.
    await expect(
      popover.locator('div.bg-accent').filter({ hasText: 'Active' }),
    ).toBeVisible();
  });

  test('test provider is listed in System Model picker', async ({ page }) => {
    await page.goto('/');
    await page.locator('#message-input').waitFor({ state: 'visible' });

    // Open the composer's model configurator dialog.
    await page.getByRole('button', { name: 'Configure models' }).click();
    await expect(
      page.getByRole('heading', { name: 'Model Configuration' }),
    ).toBeVisible();

    // Open the System Model picker (the second Cpu button in the dialog).
    const dialog = page.getByRole('dialog');
    const cpuButtons = dialog.locator('button:has(svg.lucide-cpu)');
    // The second Cpu button opens the System Model popover.
    await cpuButtons.nth(1).click();

    const popover = page.locator('div.overflow-hidden.shadow-raised').first();
    await expect(popover.locator('h3')).toHaveText('Select System Model');

    // The Test provider's models are also available in the System Model picker.
    await expect(
      popover.locator('span.font-medium', { hasText: 'Test (direct)' }),
    ).toBeVisible();
    await expect(
      popover.locator('span.font-medium', { hasText: 'Test (tool loop)' }),
    ).toBeVisible();

    // The default system model (test-direct) has the active indicator.
    await expect(popover.getByText('(active)')).toBeVisible();
  });
});
