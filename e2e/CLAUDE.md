# E2E Tests

## Testing Principle

Tests **never** call a real LLM. Always use the env-gated `test` provider/model (`YAAWC_TEST_MODE=true`), which returns deterministic, predefined outputs for given inputs — no network, no API keys, no real model anywhere in the suite. A spec that depends on a real provider's output is wrong; make the fake model scriptable instead.

Tests assert **correct** behavior — what the feature is _supposed_ to do, derived from its intent/spec — **not** whatever the code currently emits. Never reverse-engineer an assertion from observed output just to make a spec green. When a test fails, stop and determine **why**: a test defect (wrong expectation, bad setup) vs. a genuine bug in the implementation. Fix the test only if the expectation was wrong; if the code is wrong, leave the test failing and surface the bug. **If it isn't crystal clear which is at fault, ask the user — don't paper over a possible bug by editing the test.** If a spec is deliberately left red pending a fix, catalogue it in `e2e/KNOWN_ISSUES.md` (create the file if absent) and remove the entry once fixed.

## Test Model Variants

`src/lib/providers/test.ts` is scriptable by model id (`test-direct`, `test-tool`, `test-slow`, `test-embed`) — select the behavior a spec needs by choosing the model rather than special-casing a spec against real provider output. Extend it with new variants as scenarios require.

## Setup

Install Playwright browsers (run once):

```bash
npx playwright install --with-deps chromium
```

A valid `config.toml` must exist at the project root (smoke tests do not call LLMs, but the app requires the file to boot).

## Running Tests

| Command                   | Description             |
| ------------------------- | ----------------------- |
| `npm run test:e2e`        | Run all e2e tests       |
| `npm run test:e2e:smoke`  | Run smoke tests only    |
| `npm run test:e2e:ui`     | Open Playwright UI mode |
| `npm run test:e2e:report` | Open the HTML report    |

The standard local flow is `npm run build && npm run test:e2e`. Playwright's `webServer` config initializes a fresh SQLite database at `e2e/.test-data/`, runs schema migrations, and launches the standalone server — it does not run `npm run build` for you. If the dev server is already running on port 5005, it will be reused (outside CI).

## Test Database Isolation

Tests run against an isolated SQLite database at `e2e/.test-data/db.sqlite` (gitignored). The `webServer` command creates this directory and runs `drizzle-kit push` before starting the server, so the schema is always current. The `DATA_DIR` environment variable points the app at this directory, keeping the development database at `data/db.sqlite` untouched.

## Directory Layout

```
e2e/
  smoke/          Fast smoke tests
  tests/          Full feature/regression specs
  fixtures/       Extend @playwright/test — always import from here, never @playwright/test directly
  pages/          Page Object Models (add when a flow is reused across 3+ specs)
  utils/          Shared test helpers
  .auth/          Reserved for storage-state files (gitignored)
  .test-data/     Isolated test database (gitignored)
```

## Adding a Fixture

Extend `e2e/fixtures/index.ts`. Do not import from `@playwright/test` directly in specs.
