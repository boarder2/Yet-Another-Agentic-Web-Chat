import { test as base, expect } from '@playwright/test';
import { expectNoErrorOverlay } from '../utils/expectNoErrorOverlay';
import { withConnectionRetries } from './request';

export const test = base.extend({
  page: async ({ page }, use) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await use(page);

    await expectNoErrorOverlay(page);
    expect(pageErrors).toHaveLength(0);
  },
  request: async ({ request }, use) => {
    await use(withConnectionRetries(request));
  },
});

export { expect };
