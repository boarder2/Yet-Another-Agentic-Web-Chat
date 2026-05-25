import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const TEST_DATA_DIR = path.resolve('./e2e/.test-data');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  expect: {
    timeout: 5_000,
  },
  webServer: {
    command: `rm -rf ${TEST_DATA_DIR} && mkdir -p ${TEST_DATA_DIR} && npx drizzle-kit push && node .next/standalone/server.js`,
    env: {
      DATA_DIR: TEST_DATA_DIR,
    },
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'smoke',
      testDir: 'e2e/smoke',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'api',
      testDir: 'e2e/api',
    },
    {
      name: 'chromium',
      testDir: 'e2e/tests',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
