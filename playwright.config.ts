import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const TEST_DATA_DIR = path.resolve('./e2e/.test-data');
const PORT = process.env.PORT ?? '3000';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  expect: {
    timeout: 5_000,
  },
  webServer: {
    command: `rm -rf ${TEST_DATA_DIR} && mkdir -p ${TEST_DATA_DIR} && npx drizzle-kit push && node e2e/seed-settings.mjs && node .next/standalone/server.js`,
    env: {
      DATA_DIR: TEST_DATA_DIR,
      YAAWC_TEST_MODE: 'true',
      // Bind all interfaces so the readiness check on localhost connects even
      // when the container's HOSTNAME resolves to a non-loopback address.
      HOSTNAME: '0.0.0.0',
      PORT,
    },
    url: BASE_URL,
    // Never reuse an already-running server: a dev server points at the real
    // data/db.sqlite, and the seed helpers write to whatever DB the reused
    // server uses. Always boot our own fresh, DATA_DIR-isolated test server.
    reuseExistingServer: false,
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
