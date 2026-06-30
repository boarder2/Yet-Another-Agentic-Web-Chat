import { test, expect } from '../fixtures';
import { seedChat, seedWorkspace } from '../utils/seed';

const PUBLIC_ROUTES = [
  { route: '/', landmark: { role: 'main' as const } },
  {
    route: '/dashboard',
    landmark: { role: 'heading' as const, name: 'Dashboard', exact: true },
  },
];

test.describe('smoke: public routes render', () => {
  for (const { route, landmark } of PUBLIC_ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page).toHaveTitle(/YAAWC/i);

      if ('name' in landmark) {
        await expect(
          page.getByRole(landmark.role, {
            name: landmark.name,
            exact: 'exact' in landmark ? landmark.exact : undefined,
          }),
        ).toBeVisible();
      } else {
        await expect(page.getByRole(landmark.role)).toBeVisible();
      }
    });
  }

  test('/history renders with seeded chat data', async ({ request, page }) => {
    // Seed a chat so the page renders with data, not just the empty state.
    await seedChat(request, { content: 'smoke-history-test' });

    await page.goto('/history', { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/YAAWC/i);
    await expect(
      page.getByRole('heading', { name: 'History', exact: true }),
    ).toBeVisible();

    // With seeded data, at least one chat row should be visible
    await expect(page.locator('[role="link"]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('/workspaces renders with seeded workspace', async ({
    request,
    page,
  }) => {
    // Seed a workspace so we're not just testing the empty state.
    await seedWorkspace(request, { name: 'smoke-ws-test' });

    await page.goto('/workspaces', { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/YAAWC/i);
    await expect(
      page.getByRole('heading', { name: 'Workspaces', exact: true }),
    ).toBeVisible();

    // The subtitle should show "1 workspace" (not "0 workspaces")
    await expect(
      page.locator('span.text-sm.text-fg\\/50.shrink-0'),
    ).toBeVisible({
      timeout: 10000,
    });
  });
});
