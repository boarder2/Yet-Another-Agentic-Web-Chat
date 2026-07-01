# E2E Tests

## Testing Principle

Tests **never** call a real LLM. Always use the env-gated `test` provider/model (`YAAWC_TEST_MODE=true`), which returns deterministic, predefined outputs for given inputs — no network, no API keys, no real model anywhere in the suite. A spec that depends on a real provider's output is wrong; make the fake model scriptable instead.

Tests assert **correct** behavior — what the feature is _supposed_ to do, derived from its intent/spec — **not** whatever the code currently emits. Never reverse-engineer an assertion from observed output just to make a spec green. When a test fails, stop and determine **why**: a test defect (wrong expectation, bad setup) vs. a genuine bug in the implementation. Fix the test only if the expectation was wrong; if the code is wrong, leave the test failing and surface the bug. **If it isn't crystal clear which is at fault, ask the user — don't paper over a possible bug by editing the test.** If a spec is deliberately left red pending a fix, catalogue it in `e2e/KNOWN_ISSUES.md` (create the file if absent) and remove the entry once fixed.

## Test Model Variants

`src/lib/providers/test.ts` is scriptable by model id — select the behavior a spec needs by choosing the model rather than special-casing a spec against real provider output. Extend it with new variants as scenarios require.

| Model id          | Behavior                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-direct`     | Answers immediately with fixed text, no tools.                                                                                                 |
| `test-tool`       | Emits one `file_search` tool call, then a fixed answer.                                                                                        |
| `test-tool-multi` | Emits two sequential `file_search` tool calls (each after the prior result), then a fixed answer.                                              |
| `test-ask-user`   | Emits an `ask_user` tool call (triggers a real LangGraph interrupt — the run pauses `awaiting_user`); on resume, answers with fixed text.      |
| `test-structured` | If tools are bound (`withStructuredOutput`), returns a matching tool call with deterministic args; otherwise answers with `<suggestions>` XML. |
| `test-slow`       | Paces token delivery (300ms/token) so a spec can observe a run mid-stream.                                                                     |
| `test-embed`      | Deterministic fixed-vector embeddings.                                                                                                         |

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

## Test Isolation Between Specs

The test DB is shared across the whole run — it's isolated from dev data, not per-spec. A spec that persists a non-isolated change (global/app-level settings, an MCP server, a cron/scheduled task, anything not scoped to a workspace/chat it creates) must revert or delete it after the test, or it leaks into and pollutes later specs. Prefer scoping state to a fixture the spec owns (a fresh workspace/chat) when possible; when a change is unavoidably global, clean it up in the test body or an `afterEach`/`afterAll`.

## Directory Layout

```
e2e/
  smoke/          Fast smoke tests
  tests/          Full feature/regression specs
  api/            Pure HTTP specs (see e2e/api/CLAUDE.md)
  fixtures/       Extend @playwright/test — always import from here, never @playwright/test directly
  pages/          Page Object Models (add when a flow is reused across 3+ specs)
  utils/          Shared test helpers
  .auth/          Reserved for storage-state files (gitignored)
  .test-data/     Isolated test database (gitignored)
```

See `e2e/COVERAGE.md` for the route/page → spec matrix and out-of-scope table.

## Adding a Fixture

Extend `e2e/fixtures/index.ts`. Do not import from `@playwright/test` directly in specs.

## Seed & SSE Helpers

`e2e/utils/seed.ts` — API-based data factories, reused across API and UI specs to set up state without going through the UI: `seedWorkspace`, `seedChat`, `seedMemory`, `seedSkill`, `seedSystemPrompt`, `seedScheduledTask`, `seedWorkspaceFile`, `seedScheduledChat`. Each returns the created id. `seedAwaitingApproval` starts a `test-ask-user` run and returns once it pauses at the interrupt (`chatId`/`messageId`/`approvalId`/`question`); pair it with `cancelAwaitingRun` when a spec doesn't resolve the approval via `runs/resume` itself, so no unresolved approval leaks into other specs.

`e2e/utils/sse.ts` — parses the chat SSE stream: `collectSseEvents` (from a raw string or a Playwright `APIResponse`), `eventsOfType`, `joinResponseText`, `extractSources`. `streamChatUntil` reads `/api/chat` via raw `fetch` and stops as soon as a predicate matches — needed for a paused (`awaiting_user`) run, whose connection otherwise stays open indefinitely and would hang the Playwright `request` fixture.

## Page Object Models

`e2e/pages/`: `BasePage` (shared `goto`), `HomePage`, `ChatPage`, `DashboardPage`, `HistoryPage`, `MemoryPage`, `SettingsPage`, `WorkspacesPage`, `WorkspaceDetailPage`. Add a new POM once a flow is driven from 3+ specs; otherwise interact with the page directly in the spec.
