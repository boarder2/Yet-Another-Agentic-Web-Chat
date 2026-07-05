import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const TEST_DATA_DIR = path.resolve('./e2e/.test-data');
// Minimal, committed config so the suite never reads the developer's real
// config.toml (whose provider URLs would otherwise seed into the test DB).
const TEST_CONFIG = path.resolve('./e2e/config.test.toml');
const PORT = process.env.PORT ?? '5005';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// Second, dedicated server with NO ENCRYPTION_PASSPHRASE — the only way to
// exercise the "encryption not configured" blocking gate end-to-end. Separate
// port + DATA_DIR so it runs alongside the main server without conflict.
const UNCONFIGURED_PORT = String(Number(PORT) + 1);
const UNCONFIGURED_BASE_URL = `http://localhost:${UNCONFIGURED_PORT}`;
const UNCONFIGURED_DATA_DIR = path.resolve('./e2e/.test-data-unconfigured');

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
  webServer: [
    {
      command: `rm -rf ${TEST_DATA_DIR} && mkdir -p ${TEST_DATA_DIR} && npx drizzle-kit push && node e2e/seed-settings.mjs && node .next/standalone/server.js`,
      env: {
        DATA_DIR: TEST_DATA_DIR,
        YAAWC_TEST_MODE: 'true',
        // Configure a fixed public origin (distinct from the bind port) so the
        // opensearch origin-detection specs are deterministic regardless of the
        // local config.toml.
        BASE_URL: 'http://localhost:3000',
        // Required for credential encryption (src/lib/encryption.ts). Supplied
        // via env rather than the shared config.toml so tests never depend on —
        // or need to seed — a real passphrase.
        ENCRYPTION_PASSPHRASE: 'e2e-test-passphrase-not-a-secret',
        // Bind all interfaces so the readiness check on localhost connects even
        // when the container's HOSTNAME resolves to a non-loopback address.
        HOSTNAME: '0.0.0.0',
        PORT,
        CONFIG_PATH: TEST_CONFIG,
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
    {
      // No settings seed — this server only needs to boot far enough for the
      // `encryption-gate` project to confirm the app blocks itself.
      command: `rm -rf ${UNCONFIGURED_DATA_DIR} && mkdir -p ${UNCONFIGURED_DATA_DIR} && npx drizzle-kit push && node .next/standalone/server.js`,
      env: {
        DATA_DIR: UNCONFIGURED_DATA_DIR,
        YAAWC_TEST_MODE: 'true',
        BASE_URL: 'http://localhost:3000',
        HOSTNAME: '0.0.0.0',
        PORT: UNCONFIGURED_PORT,
        CONFIG_PATH: TEST_CONFIG,
        // Explicit empty passphrase forces the "not configured" state, so the
        // gate is exercised regardless of any passphrase in the local config.toml.
        ENCRYPTION_PASSPHRASE: '',
      },
      url: UNCONFIGURED_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
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
    {
      // Specs that mutate instance-wide, DB-synced settings (composer
      // model/panel selection, dashboard widgets, memory toggles, ...) and
      // can't tolerate a concurrently-running spec observing dirty state.
      // A single worker with fullyParallel off makes that obvious from the
      // project alone, so specs don't need their own cross-worker mutex.
      name: 'serial',
      testDir: 'e2e/serial',
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Runs against the second, ENCRYPTION_PASSPHRASE-less webServer to
      // exercise the "not configured" blocking gate — the main server always
      // has a passphrase set, so this state can't be reached there.
      name: 'encryption-gate',
      testDir: 'e2e/encryption-gate',
      use: { ...devices['Desktop Chrome'], baseURL: UNCONFIGURED_BASE_URL },
    },
  ],
});
