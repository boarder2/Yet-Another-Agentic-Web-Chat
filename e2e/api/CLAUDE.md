# API Tests

Pure HTTP tests against route handlers under `src/app/api/**`. No browser is launched — these use Playwright's `request` fixture and run much faster than UI specs.

## When to add an API test vs. a UI test

- **API test:** contract checks — status codes, payload shape, validation errors, auth boundaries, query-param handling. Anything that's about the HTTP layer.
- **UI test:** user-visible behavior — does the page render, does clicking X produce visible result Y. Don't re-test API permutations through the browser.

## Conventions

- Import `test` and `expect` from `../fixtures/api` (not `@playwright/test`).
- One file per route group (`chats.spec.ts` covers `/api/chats` and `/api/chats/[id]`).
- Use `request.get`/`request.post` etc. The `baseURL` from `playwright.config.ts` is applied automatically.
- Assert **expected values**, not just shape — check the actual returned contents (the name/content you created, the computed count, the post-mutation state). Shape/presence/type checks (`toHaveProperty`, `typeof`, non-empty) are reserved only for values you genuinely can't know exactly, like system-generated dates or ids — and even then assert what's knowable (type, format, non-empty).
- Assert **correct** behavior, not current behavior — expectations come from how the endpoint is _meant_ to behave, never reverse-engineered from current output to force a green. On failure, triage: wrong expectation → fix the test; handler bug → leave it failing and surface it. Ask the user when it's ambiguous.
- Tests must be independent — create the resources they need, don't rely on ordering.
- **Never** hit a real LLM — use the `test` provider/model (`YAAWC_TEST_MODE=true`) that returns predefined outputs for given inputs. Any route that runs the model must be exercised against the fake one.

## Running

```bash
npm run test:e2e --project=api
```
