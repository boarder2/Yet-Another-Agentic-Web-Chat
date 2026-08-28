---
name: yaawc-testing
description: Unit versus mocked-LLM Playwright testing, fixtures, isolated data, serial settings state, and coverage placement.
---

# Testing YAAWC

Use the lowest level that proves the behavior. Do not duplicate unit coverage in e2e unless e2e verifies an additional application boundary.

## Choose the level

- **Vitest** (`src/**/*.test.ts`): pure or isolated module behavior. Node-only; no browser, real network, or LLM. Its config pins a test encryption passphrase and stubs `server-only`; tests must not depend on ambient credentials or production-only module behavior.
- **Playwright API** (`e2e/api/`): HTTP status, payload, validation, auth, and query contracts. Keep one spec per route group and create its resources.
- **Playwright UI** (`e2e/tests/`): user workflows and full application boundaries.
- **Smoke** (`e2e/smoke/`): fast health/navigation checks.
- **Serial** (`e2e/serial/`): tests that mutate instance-wide DB-synced settings or other shared global state.
- **Encryption gate** (`--project=encryption-gate`): only the passphrase-unconfigured blocking state; there is no dedicated package alias.

Assert intended, knowable behavior—not whatever the implementation currently emits. Investigate ambiguous failures instead of weakening assertions.

## Commands

- `npm run test:unit` — Vitest.
- `DATA_DIR=/tmp/yaawc-e2e-build npm run test:e2e -- --project=api` (or `chromium`, `smoke`, `encryption-gate`) — focused Playwright project.
- `DATA_DIR=/tmp/yaawc-e2e-build npm run test:e2e:serial` — serial only; its script uses `--no-deps`.
- `DATA_DIR=/tmp/yaawc-e2e-build npm run test:e2e` — all Playwright projects after a standalone build.
- `npm run test` — the CI gate: unit then full e2e.

E2e uses `.next/standalone/server.js`, not the dev server. The package scripts build before Playwright applies its server-specific environment, so prefix them with a disposable explicit `DATA_DIR` as above or the build can touch the developer DB. Playwright then recreates its own server data directories. Run the narrowest relevant target first, then broader gates when warranted. Also run lint/typecheck for code changes.

## Mocked models only

E2e must never call a real LLM or require provider credentials. `YAAWC_TEST_MODE=true` registers deterministic model variants in `src/lib/providers/test.ts`; choose the variant matching the scenario or add a deterministic one there. `test-embed` supplies deterministic embeddings.

Capability-doc test variants must exercise the real non-toggleable `search_yaawc_docs` tool path rather than mocking the route/service. Mapping integration variants use the env-gated deterministic mapping provider selected by a reusable fixture; tile hosts are intercepted in the browser, and no real geocoder, places, routing, tile, or LLM service may be contacted. Keep `e2e/config.test.toml` free of provider URLs and keys; `seed-settings.mjs` establishes baseline test models/settings.

## Data isolation

Playwright recreates `e2e/.test-data`, pushes the schema, seeds settings/data, and starts the app with one explicit `DATA_DIR`, test config, and passphrase. The encryption-gate project uses a separate data directory and port with no passphrase.

Isolation is per run, not per spec: specs share one test DB. Prefer fresh chat/workspace-scoped resources. Clean up or restore global settings, MCP servers, workflows/schedules, Mapping settings, and other unscoped state. Put tests that necessarily mutate instance-wide state in the serial project.

Never point e2e at a developer server or developer DB.

## Fixtures and helpers

Import UI tests from `e2e/fixtures` and API tests from `e2e/fixtures/api`, never directly from `@playwright/test`. These fixtures enforce page-error/overlay checks and request behavior.

Use:

- `e2e/utils/seed.ts` for chats, workspaces/files, skills, memories, workflows/schedules, artifacts, images, and approvals.
- `e2e/utils/sse.ts` for NDJSON/SSE parsing and interrupt-aware incremental reads.
- Approval cleanup helpers so unresolved runs do not leak pending state.

The request wrapper retries connection failures only, never HTTP status failures. Add Page Objects only for flows reused by at least three specs; otherwise keep the flow local.

## Placement and documentation

Keep API permutations out of UI tests. Add one integration assertion for the boundary, then exercise detailed cases at unit/API level. When route/page coverage changes, update `e2e/COVERAGE.md`. A deliberately red known issue belongs in `e2e/KNOWN_ISSUES.md`.

Read `e2e/CLAUDE.md` completely before e2e work and `e2e/api/CLAUDE.md` for API specs; those files are authoritative for current fixtures/projects.

Related skills: `yaawc-dev-smoke` for exploratory local checks; `playwright-cli` for manual browser commands; subsystem skills for domain-specific invariants.
