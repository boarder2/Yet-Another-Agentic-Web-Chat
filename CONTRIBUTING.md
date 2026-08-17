# Contributing

Thanks for helping improve YAAWC. Keep changes focused, describe the user
impact, and do not commit local configuration or data.

## Set up

Use Node 24 and npm. From a checkout:

```bash
cp sample.config.toml config.toml  # only when config.toml does not exist
npm install
export DATA_DIR="$PWD/data"
npm run db:push
npm run dev
```

Never overwrite an existing `config.toml`; set a non-empty
`[SECURITY].ENCRYPTION_PASSPHRASE` before saving provider credentials. Keep the
same explicit `DATA_DIR` for Drizzle, build, development, and runtime commands:
the application and `drizzle-kit` have different defaults when it is unset.
Docker and a reachable SearXNG service are needed for the corresponding
features. Local `config.toml` is intentionally ignored; do not add
secrets, database files, uploads, or workspace blobs to a change.

## Required workflow

- Review the relevant [capability documentation](docs/capabilities/README.md)
  for every user-visible change. Update the authoritative page when behavior,
  prerequisites, limits, privacy, availability, or failure states change; do
  not add roadmap or history prose.
- Run `npm run format:write`, `npm run lint`, and `npx tsc --noEmit`.
- Run the applicable tests. Prefer `npm run test:unit` for pure or isolated
  behavior; use `npm run test:e2e` for browser/UI workflows and full-application
  or HTTP-contract behavior. `npm run test` is the full configured gate. If a
  check is not applicable or cannot run, explain why in the pull request.
- For a database schema change, edit `src/lib/db/schema.ts`, run
  `npm run db:generate`, and include the generated migration. Never hand-write
  files in `drizzle/`.
- For a UI change, include a screenshot in the pull request. For documentation
  changes, check links, commands, and rendered pages as applicable.

## Pull requests

Use the repository pull-request template. Include a concise summary and
validation results. A related issue is encouraged but optional. Mark the
conditional tests, documentation, UI screenshot, and schema-migration items
that apply, and call out any skipped check or migration risk.
