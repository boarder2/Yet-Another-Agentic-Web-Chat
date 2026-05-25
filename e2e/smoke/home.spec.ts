import { test, expect } from '../fixtures';

const PUBLIC_ROUTES = [
  { route: '/', landmark: { role: 'main' as const } },
  {
    route: '/settings',
    landmark: { role: 'heading' as const, name: 'Settings' },
  },
  {
    route: '/library',
    landmark: { role: 'heading' as const, name: 'Library' },
  },
  { route: '/memory', landmark: { role: 'heading' as const, name: 'Memory' } },
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
