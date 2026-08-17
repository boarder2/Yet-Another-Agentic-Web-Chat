import { test as base, expect } from '@playwright/test';
import { withConnectionRetries } from './request';

export const test = base.extend({
  request: async ({ request }, use) => {
    await use(withConnectionRetries(request));
  },
});

export { expect };
export type { APIRequestContext, Page } from '@playwright/test';
