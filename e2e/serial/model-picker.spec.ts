import { test, expect } from '../fixtures';
import { expectComposerPopover } from '../utils/composerPopover';

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

  test('test provider and models are listed in both the Chat and System Model pickers', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#message-input').waitFor({ state: 'visible' });

    // Open the composer's model configurator dialog.
    await page.getByRole('button', { name: 'Configure models' }).click();
    await expect(
      page.getByRole('heading', { name: 'Model Configuration' }),
    ).toBeVisible();
    const dialog = page.getByRole('dialog');

    await test.step('test provider and models are listed in Chat Model picker, with test-direct as the default', async () => {
      // Open the Chat Model grouped picker (the first ModelField — the Cpu
      // button).
      await dialog.locator('button:has(svg.lucide-cpu)').first().click();

      // ModelField owns the nested shared composer shell inside the dialog.
      const popover = await expectComposerPopover(page, 'Select Chat Model');
      await expect(popover.locator('h3')).toHaveText('Select Chat Model');

      // The seeded default chat model is test/test-direct, so the Test
      // provider is pre-expanded and marked active, exposing its two models.
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

      await page.keyboard.press('Escape');
    });

    await test.step('test provider is listed in System Model picker', async () => {
      // Open the System Model picker (the second Cpu button in the dialog).
      const cpuButtons = dialog.locator('button:has(svg.lucide-cpu)');
      // The second Cpu button opens the System Model popover.
      await cpuButtons.nth(1).click();

      const popover = await expectComposerPopover(page, 'Select System Model');

      // The Test provider's models are also available in the System Model
      // picker.
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
});
