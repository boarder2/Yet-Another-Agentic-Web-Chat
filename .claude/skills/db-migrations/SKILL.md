---
name: db-migrations
description: Use when changing the database — adding or altering a table/column, the Drizzle schema, generating or applying migrations, or writing DB queries. Covers schema.ts, db:generate/db:push, and where query helpers live.
---

# DB Schema & Migrations

SQLite + Drizzle ORM. The DB file is `db.sqlite` at the repo root (a working file is required for `npm run build`).

## Golden rules

- **Edit `src/lib/db/schema.ts` only.** It is the single source of truth (`drizzle.config.ts`: `dialect: 'sqlite'`, `schema: ./src/lib/db/schema.ts`, `out: ./drizzle`).
- **Never hand-write or hand-edit files in `drizzle/`.** They are generated SQL migrations.

## Workflow

1. Edit `src/lib/db/schema.ts` (add/change a table or column using Drizzle's `sqliteTable` builders).
2. Run `npm run db:generate` (`drizzle-kit generate`) → emits a new numbered migration in `drizzle/` (e.g. `0010_*.sql`). Commit the generated file alongside the schema change.
3. Apply with `npm run db:push` (`drizzle-kit migrate && drizzle-kit push`). `npm run build` runs `db:push` first, so a build also applies pending migrations. `src/lib/db/migrate.ts` runs the migrator against the `drizzle/` folder at startup.

## Where things live

- `src/lib/db/schema.ts` — tables (chats, messages, `app_settings`, workspaces, scheduled tasks, etc.).
- `src/lib/db/index.ts` — the `db` client (default export).
- `src/lib/db/queries.ts`, `chatSearch.ts`, `messageLookup.ts` — query helpers; add new queries here rather than inlining raw Drizzle in routes/components.
- `drizzle/` — generated migrations (`NNNN_name.sql`); do not touch by hand.

## Notes

- New settings usually do **not** need a schema change — they go in the `app_settings` key/value table via the allowlist (see the `settings-persistence` skill).
- Client-side server-state reads go through TanStack Query hooks in `src/lib/hooks/api/` (see CLAUDE.md "Data Fetching"), not direct DB access.

Related: `settings-persistence`, `api-endpoints`.
