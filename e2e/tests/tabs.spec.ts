import { test, expect } from '../fixtures';
import { seedWorkspace } from '../utils/seed';

/**
 * The four content-switching tab rows all render through the shared
 * `Tabs` primitive (src/components/ui/Tabs.tsx). Each test drives one row and
 * asserts it is a real `role="tablist"` of `role="tab"` items, that the active
 * tab carries `aria-selected`, and that picking a different tab swaps the
 * visible section. No styling assertions — the unified pill look is asserted
 * by humans, structure by these specs.
 */
test.describe('shared Tabs: history', () => {
  test('renders a tablist and switching tabs swaps the visible section', async ({
    page,
  }) => {
    await page.goto('/history');

    const tablist = page.getByRole('tablist', { name: 'History' });
    await expect(tablist).toBeVisible();

    const conversations = tablist.getByRole('tab', { name: 'Conversations' });
    const artifacts = tablist.getByRole('tab', { name: 'Artifacts' });
    for (const tab of [conversations, artifacts]) {
      await expect(tab).toHaveClass(/focus-border-neutral/);
      await expect(tab).toHaveCSS('border-top-width', '1px');
      await expect(tab).not.toHaveClass(/focus-visible:outline/);
    }
    await expect(conversations).toHaveAttribute('aria-selected', 'true');
    await expect(artifacts).toHaveAttribute('aria-selected', 'false');
    // Conversations is the default section: the chat browser (its search box)
    // is visible and the artifact browser is not.
    const chatSearch = page.getByPlaceholder('Search conversations...');
    await expect(chatSearch).toBeVisible();

    await artifacts.click();
    await expect(page).toHaveURL(/tab=artifacts/);
    await expect(artifacts).toHaveAttribute('aria-selected', 'true');
    await expect(conversations).toHaveAttribute('aria-selected', 'false');
    // The artifact browser has swapped in for the chat browser. The artifact
    // list content depends on shared-DB state (other specs seed artifacts), so
    // assert the swap by the chat browser disappearing, not store outcome.
    await expect(chatSearch).toBeHidden();
  });
});

test.describe('shared Tabs: automations', () => {
  test('switching tabs routes between Workflows and Scheduled Tasks', async ({
    page,
  }) => {
    await page.goto('/automations');
    await expect(
      page.getByRole('heading', { name: 'Workflows', exact: true }),
    ).toBeVisible();

    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();
    const workflows = tablist.getByRole('tab', { name: 'Workflows' });
    const scheduled = tablist.getByRole('tab', { name: 'Scheduled Tasks' });
    await expect(workflows).toHaveAttribute('aria-selected', 'true');
    await expect(scheduled).toHaveAttribute('aria-selected', 'false');

    await scheduled.click();
    await expect(page).toHaveURL(/\/automations\/scheduled/);
    await expect(
      page.getByRole('heading', { name: 'Scheduled Tasks', exact: true }),
    ).toBeVisible();
    await expect(scheduled).toHaveAttribute('aria-selected', 'true');
    await expect(workflows).toHaveAttribute('aria-selected', 'false');
  });
});

test.describe('shared Tabs: workspace mobile', () => {
  test('mobile workspace tabs switch sections', async ({ page, request }) => {
    const workspaceId = await seedWorkspace(request, {
      name: `tabs-ws-${Date.now()}`,
    });

    // The workspace tabs live in the `lg:hidden` mobile layout.
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(`/workspaces/${workspaceId}`);

    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 15_000 });

    const chats = tablist.getByRole('tab', { name: 'Chats' });
    const files = tablist.getByRole('tab', { name: 'Files' });
    await expect(chats).toHaveAttribute('aria-selected', 'true');
    // Chats is the default section for a fresh (empty) workspace. The same
    // text is rendered by the hidden desktop ChatBrowser too, so scope to the
    // first (the mobile, visible) instance.
    await expect(
      page.getByText('No chats in this workspace yet.').first(),
    ).toBeVisible();

    await files.click();
    await expect(files).toHaveAttribute('aria-selected', 'true');
    await expect(chats).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByText('No files yet.')).toBeVisible();

    const memory = tablist.getByRole('tab', { name: 'Memory' });
    await memory.click();
    await expect(memory).toHaveAttribute('aria-selected', 'true');
    await expect(files).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByText('No workspace memories yet.')).toBeVisible();
  });
});

test.describe('shared Tabs: settings mobile nav', () => {
  test('the settings modal mobile nav is a tablist that switches sections', async ({
    page,
  }) => {
    // The settings "mobile nav" only shows under `lg`, so drive it with a
    // phone-sized viewport.
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/');

    // The home page's header settings trigger (desktop sidebar one is hidden
    // on a narrow viewport, so scope to the visible instance).
    await page.locator('[aria-label="Settings"]:visible').click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    const tablist = modal.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 15_000 });

    const personalization = tablist.getByRole('tab', {
      name: 'Personalization',
    });
    const appearance = tablist.getByRole('tab', { name: 'Appearance' });
    await expect(personalization).toHaveAttribute('aria-selected', 'true');
    await expect(appearance).toHaveAttribute('aria-selected', 'false');
    await expect(
      modal.getByRole('heading', { name: 'Personalization', exact: true }),
    ).toBeVisible();

    await appearance.click();
    await expect(appearance).toHaveAttribute('aria-selected', 'true');
    await expect(personalization).toHaveAttribute('aria-selected', 'false');
    await expect(
      modal.getByRole('heading', { name: 'Appearance', exact: true }),
    ).toBeVisible();
  });
});
