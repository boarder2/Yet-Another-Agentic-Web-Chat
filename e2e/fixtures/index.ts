import { test as base, expect } from '@playwright/test';
import { expectNoErrorOverlay } from '../utils/expectNoErrorOverlay';

export const test = base.extend({
  page: async ({ page }, use) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await use(page);

    await expectNoErrorOverlay(page);
    expect(pageErrors).toHaveLength(0);
  },
});

export { expect };
