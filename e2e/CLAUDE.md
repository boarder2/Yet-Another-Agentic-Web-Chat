# E2E Tests

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
