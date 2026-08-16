---
name: consolidate-e2e-tests
description: Audit and consolidate YAAWC's Playwright end-to-end suite without losing legitimate behavior, risk, or regression coverage.
disable-model-invocation: true
---

# Consolidate E2E Tests

Consolidate YAAWC's Playwright suite while preserving every unique contract and regression guarantee. Optimize in this order:

1. Preserve unique risk coverage.
2. Reduce wall-clock runtime.
3. Reduce flakiness.
4. Reduce maintenance burden.

Test count and lines deleted are not success metrics. Similar code is not proof of redundant coverage.

## Arguments

An optional argument scopes the audit:

- no argument — the whole suite
- a Playwright project — `api`, `chromium`, `serial`, `smoke`, or `encryption-gate`
- a path — a spec, directory, or glob under `e2e/`
- `since <ref>` — tests changed since the merge-base with `<ref>`; include related specs elsewhere when they may duplicate or preserve the same behavior

Resolve and state the scope before doing anything. Inventory every test in that scope. Search outside it for counterpart coverage, but do not propose out-of-scope edits without identifying them explicitly.

## 1. Establish the rules

Read these files completely before judging tests:

- `AGENTS.md`
- `e2e/CLAUDE.md`
- `e2e/COVERAGE.md`
- `e2e/api/CLAUDE.md` when API tests are in or relevant to scope
- `playwright.config.ts`
- the relevant fixtures, helpers, page objects, capability docs, and subsystem skills

Treat `e2e/COVERAGE.md` as an index, not proof that two tests provide equivalent coverage.

## 2. Require a known-good baseline

Do not audit, recommend, or edit until the current checkout passes a fresh baseline.

1. Inspect `git status --short`.
   - If the tree is dirty, identify the unrelated changes and ask the user to acknowledge them before running the read-only baseline or audit.
   - A dirty tree may be audited after acknowledgement, but it must be clean before implementation. Never stash, discard, overwrite, or include unrelated changes yourself.
2. Create timestamped baseline logs under `${TMPDIR:-/tmp}`.
3. Run `npm run test:unit`.
4. Run the full e2e suite with one worker and no retries:

   ```bash
   npm run test:e2e -- --workers=1 --retries=0
   ```

5. Record separately:
   - unit-test wall time
   - full e2e command wall time, including build and server startup
   - Playwright's reported execution time
   - passed, skipped, and failed counts

Use `/usr/bin/time` when available; otherwise record timestamps around each command. Preserve complete command output in the temporary logs.

**Any failure aborts the entire run.** Do not inspect candidates, generate recommendations, weaken assertions, mark tests skipped, or optimize an unrelated area. Report the failing command and log path. A retry-assisted pass or an older CI result is not a baseline. If browsers, infrastructure, or available time prevent the full baseline, abort.

## 3. Build a behavior and risk inventory

Use `npx playwright test --list` plus source inspection to enumerate the selected tests. For large scopes, fan out by Playwright project or feature when parallel sub-agents are available, then reconcile their inventories centrally. Otherwise inspect sequentially.

For each test, identify:

- behavior or contract asserted
- regression or failure mode guarded
- layer and seam exercised: pure logic, HTTP, persistence, streaming, browser rendering, accessibility, navigation, or cross-module integration
- preconditions, action, and observable outcome
- expensive setup: builds, browser contexts, navigation, model turns, polling, sleeps, or repeated database state
- state/isolation requirements and why it belongs in its current Playwright project
- counterpart tests that appear to cover the same behavior

Classify each test or repeated block:

- `unique` — protects a distinct behavior, seam, risk, project gate, or regression
- `duplicated` — another test protects the same behavior and risk at an equal or stronger layer
- `mis-layered` — coverage is legitimate, but a browser test adds no browser or integration confidence
- `setup-heavy` — coverage is legitimate, but setup or flow is needlessly repeated
- `obsolete` — the documented product contract no longer exists; requires direct evidence
- `unclear` — purpose or historical regression intent cannot be established

Before classifying ambiguous coverage as duplicated or obsolete, inspect `git blame`, relevant commits, issue references, and current capability documentation. If intent remains unclear, classify it `unclear` and retain it.

### Coverage equivalence test

A removal or relocation is safe only when the inventory shows what protects each old behavior afterward. Compare:

- precondition and state
- user or caller action
- exercised seam
- expected result
- error/failure branch
- historical regression intent
- execution role, such as a fast smoke gate versus exhaustive coverage

Overlap is not equivalence. In particular:

- A smoke test may intentionally overlap a full test because it serves a different gate.
- An API test does not replace browser wiring, rendering, accessibility, or navigation coverage.
- A UI test need not repeat API validation permutations when it only needs to prove the visible flow is wired correctly.
- Different permissions, scopes, persistence boundaries, responsive states, interrupt/reconnect paths, and failure branches are distinct until proven otherwise.
- Flakiness and runtime cost are never evidence that coverage is unnecessary.

## 4. Find worthwhile transformations

Prefer, in order:

1. Remove redundant navigation, model runs, polling, and setup.
2. Reuse existing fixtures, API seed factories, SSE helpers, and page objects where their reuse rule is met.
3. Parameterize genuinely identical contracts without obscuring which case failed.
4. Combine assertions only when they belong to one lifecycle and a later assertion cannot hide an earlier failure.
5. Move HTTP contracts to API tests and pure behavior to unit tests when the browser adds no unique confidence.
6. Delete a test or assertion only after proving its old coverage remains at an equal or stronger layer.
7. Consider worker/project changes only after shared-state dependencies have been removed structurally.

Reject:

- unrelated mega-tests
- ordering dependencies
- shared mutable state introduced to save setup
- broad helpers that hide intent or failure location
- replacement assertions weaker than the originals
- consolidation whose only benefit is fewer files, tests, or lines
- production-code changes made merely to complete the consolidation

A change must materially improve runtime, isolation, clarity, or maintenance enough to justify its migration risk. Production seams may be reported separately but require explicit approval outside this skill's default scope.

## 5. Report before editing

Write a numbered Markdown report to:

```text
${TMPDIR:-/tmp}/e2e-consolidation-<timestamp>.md
```

Do not write the audit into the repository. Include:

- scope and files inspected
- baseline commands, counts, wall times, Playwright time, and log paths
- inventory summary by classification
- known unique coverage that constrains consolidation
- ranked recommendations
- unclear tests retained for safety

For every recommendation include:

1. exact specs and test titles
2. classification and evidence
3. duplicated cost or setup
4. unique coverage that must survive
5. proposed transformation
6. an explicit old test/assertion → retained or relocated coverage map
7. estimated runtime/maintenance benefit without inventing precision
8. confidence and risk
9. validation commands

Show only evidence-backed recommendations. End by asking: **"Which numbered recommendations should I implement?"** Touch nothing until the user selects.

## 6. Implement selected recommendations

Before editing, require `git status --short` to be clean. If it is not, stop and ask the user to clean or stash their changes; do not do it for them.

Apply selected recommendations in small, independently testable batches. Preserve report numbers throughout. Before each batch, restate the coverage map that must remain true.

Allowed changes are limited to tests, fixtures, helpers, page objects, Playwright configuration, deterministic test-provider behavior, and test documentation. Stop for separate approval before changing ordinary production behavior.

For each batch:

1. Make the smallest coherent change.
2. Remove helpers, imports, fixtures, and files orphaned by that change.
3. Update `e2e/COVERAGE.md` when coverage ownership, location, or scope changes.
4. Run Playwright test listing to catch discovery mistakes.
5. Run the directly affected tests with `--retries=0`.
6. Run every affected Playwright project with `--retries=0`.
7. Compare targeted timings using repeated runs when the expected saving is small or noisy.

Any failure stops implementation. Determine whether the batch exposed a product bug or contains a test defect; never edit expectations merely to obtain green. Restore only the current batch's own changes when reverting is clearly correct, and never use destructive repository-wide commands.

### Parallelism recommendations

Treat increased parallelism as high risk. Keep tests in `serial` unless isolation is structurally demonstrated. In addition to the ordinary one-worker correctness gate, run the proposed CI worker configuration race-free at least three times with zero retries. Report all runs, not only the fastest one.

## 7. Final verification

After all selected batches:

1. Run `npm run test:unit`.
2. Run the full suite using the exact baseline command:

   ```bash
   npm run test:e2e -- --workers=1 --retries=0
   ```

3. Record timings using the same method as the baseline.
4. If Playwright parallelism changed, also benchmark and validate the intended CI configuration repeatedly.
5. Review the final diff for accidental coverage loss, weakened assertions, hidden ordering, stale coverage documentation, and unrelated changes.

Do not claim a speedup from timing noise. A batch may be runtime-neutral when it demonstrably improves isolation or maintenance, but it must not materially regress runtime without an explicitly approved stronger benefit. Revert a batch that fails its accepted benefit.

Report:

- baseline versus final timings and counts
- recommendations implemented, rejected, and deferred
- tests/assertions removed, combined, or relocated
- final old → retained coverage map
- validation commands and outcomes
- remaining uncertainty or risk

Do not create a permanent audit artifact unless the user requests one.
