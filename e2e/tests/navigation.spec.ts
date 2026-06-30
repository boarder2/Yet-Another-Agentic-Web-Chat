import { test, expect } from '../fixtures';
import { HomePage } from '../pages/HomePage';
import { DashboardPage } from '../pages/DashboardPage';
import { WorkspacesPage } from '../pages/WorkspacesPage';
import { HistoryPage } from '../pages/HistoryPage';
import { SettingsPage } from '../pages/SettingsPage';

const DESTINATIONS = [
  { label: 'Chat', url: '/', POM: HomePage, landmark: '#message-input' },
  {
    label: 'Dashboard',
    url: '/dashboard',
    POM: DashboardPage,
    heading: 'Dashboard',
  },
  {
    label: 'Workspaces',
    url: '/workspaces',
    POM: WorkspacesPage,
    heading: 'Workspaces',
  },
  { label: 'Scheduled', url: '/scheduled-tasks', heading: 'Scheduled Tasks' },
  { label: 'History', url: '/history', POM: HistoryPage, heading: 'History' },
] as const;

test.describe('navigation: sidebar links', () => {
  for (const d of DESTINATIONS) {
    test(`navigate to ${d.label} via sidebar link`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Click the sidebar nav link (desktop layout: fixed sidebar). The
      // new-chat button also links to "/", so target the nav link (last match).
      const link = page.locator(`.hidden.lg\\:fixed a[href="${d.url}"]`).last();
      await link.click();

      await page.waitForURL((u) => u.pathname === d.url);

      // Assert the destination's landmark is visible.
      if ('heading' in d && d.heading) {
        await expect(
          page.getByRole('heading', { name: d.heading, exact: true }),
        ).toBeVisible({ timeout: 15_000 });
      } else if ('landmark' in d && d.landmark) {
        await expect(page.locator(d.landmark)).toBeVisible({ timeout: 15_000 });
      }
    });

    test(`sidebar active state for ${d.label}`, async ({ page }) => {
      // Navigate to the page directly, then check the sidebar link is active.
      await page.goto(d.url);
      await page.waitForLoadState('networkidle');

      const activeLink = page
        .locator(`.hidden.lg\\:fixed a[href="${d.url}"]`)
        .last();
      // The active link has bg-surface-2 and text-accent classes.
      await expect(activeLink).toBeVisible();
      const classes = (await activeLink.getAttribute('class')) ?? '';
      expect(classes).toContain('bg-surface-2');
      expect(classes).toContain('text-accent');
    });
  }
});

test.describe('navigation: Settings', () => {
  test('opens the settings modal via the sidebar button', async ({ page }) => {
    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.isOpen()).resolves.toBe(true);

    // The settings dialog heading should be visible.
    await expect(page.getByText('Settings').first()).toBeVisible();

    await settings.close();
    await expect(settings.isOpen()).resolves.toBe(false);
  });
});
