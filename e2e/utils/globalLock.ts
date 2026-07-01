import fs from 'fs';
import path from 'path';

const LOCK_DIR = path.join(__dirname, '..', '.test-data', '.locks');
const POLL_MS = 100;
// All specs sharing this lock queue up behind one another (see
// useSharedSettingsLock), so a test near the back of the queue can wait far
// longer than its own runtime — this must comfortably exceed that worst-case
// cumulative wait, not just one test's own execution time.
const ACQUIRE_TIMEOUT_MS = 100_000;
// Playwright's own default 30s per-test timeout would otherwise fire (with an
// unhelpful generic message) before a queued test ever gets a turn. Specs that
// hold this lock via a hand-rolled beforeEach (rather than
// useSharedSettingsLock) should call `test.setTimeout(TEST_TIMEOUT_MS)`
// themselves before acquiring.
export const TEST_TIMEOUT_MS = 120_000;

/**
 * Shared lock name for every spec that reads or writes an instance-wide,
 * DB-synced `app_settings` row through the UI or a direct `/api/settings`
 * PATCH (composer model/panel selection, memory toggles, dashboard widgets,
 * autoSuggestions, TTS prefs, ...). Cross-device sync of these settings is a
 * real feature (see `src/lib/settings/keys.ts`), not a test artifact — a spec
 * mutating one mid-run legitimately propagates to any other browser hydrating
 * from the DB at that moment, so specs touching this shared state must not
 * run concurrently with each other.
 */
export const SHARED_SETTINGS_LOCK = 'shared-app-settings';

/**
 * Filesystem mutex shared across Playwright workers, which all run against
 * one shared server + DB (unlike separate browsers, they aren't isolated from
 * each other). Use this to serialize specs that mutate instance-wide,
 * DB-synced settings (e.g. `panelSelection`) against specs that read them at
 * send time, so one spec's in-progress global state can't bleed into another
 * spec's concurrently-running, unrelated request.
 *
 * `mkdir` on a non-existent path is atomic, so exactly one caller ever wins
 * the race to create `lockPath`; losers poll until the holder removes it.
 * Returns a release function — always call it in a `finally`/`afterEach`.
 */
export async function acquireGlobalLock(name: string): Promise<() => void> {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const lockPath = path.join(LOCK_DIR, `${name}.lock`);
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return () => fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for global lock "${name}" (held at ${lockPath})`,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

interface HookableTest {
  beforeEach: (fn: () => Promise<void> | void) => void;
  afterEach: (fn: () => Promise<void> | void) => void;
  setTimeout: (ms: number) => void;
}

/**
 * Wire up `beforeEach`/`afterEach` hooks that hold `SHARED_SETTINGS_LOCK` for
 * the duration of each test in the calling spec file. Call once at the top of
 * any spec that reads or writes a shared, DB-synced setting (see
 * `SHARED_SETTINGS_LOCK`'s doc comment for which ones qualify).
 */
export function useSharedSettingsLock(test: HookableTest): void {
  let release: (() => void) | undefined;
  test.beforeEach(async () => {
    // Queued tests can wait far longer than Playwright's default 30s test
    // timeout before getting a turn — extend it up front, before the wait.
    test.setTimeout(TEST_TIMEOUT_MS);
    release = await acquireGlobalLock(SHARED_SETTINGS_LOCK);
  });
  test.afterEach(() => {
    release?.();
    release = undefined;
  });
}
