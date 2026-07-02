import { expect, Page } from '@playwright/test';

export async function expectNoErrorOverlay(page: Page) {
  await expect(page.locator('[data-nextjs-dialog]')).not.toBeVisible();
  await expect(page.locator('[data-nextjs-toast]')).not.toBeVisible();
}
