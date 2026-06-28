# API Tests

Pure HTTP tests against route handlers under `src/app/api/**`. No browser is launched — these use Playwright's `request` fixture and run much faster than UI specs.

## When to add an API test vs. a UI test

- **API test:** contract checks — status codes, payload shape, validation errors, auth boundaries, query-param handling. Anything that's about the HTTP layer.
- **UI test:** user-visible behavior — does the page render, does clicking X produce visible result Y. Don't re-test API permutations through the browser.

## Conventions

- Import `test` and `expect` from `../fixtures/api` (not `@playwright/test`).
- One file per route group (`chats.spec.ts` covers `/api/chats` and `/api/chats/[id]`).
- Use `request.get`/`request.post` etc. The `baseURL` from `playwright.config.ts` is applied automatically.
- Prefer asserting on shape (`expect(body).toHaveProperty('chats')`) over exact values where data is dynamic.
- Tests must be independent — create the resources they need, don't rely on ordering.

## Running

```bash
npm run test:e2e --project=api
```
