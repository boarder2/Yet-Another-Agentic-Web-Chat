import { test, expect } from '../fixtures';

const PUBLIC_ROUTES = [
  { route: '/', landmark: { role: 'main' as const } },
  {
    route: '/history',
    landmark: { role: 'heading' as const, name: 'History', exact: true },
  },
  {
    route: '/workspaces',
    landmark: { role: 'heading' as const, name: 'Workspaces', exact: true },
  },
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
});
