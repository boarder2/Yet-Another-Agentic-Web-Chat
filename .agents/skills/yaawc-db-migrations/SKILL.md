---
name: yaawc-db-migrations
description: Use when changing the database — the Drizzle schema, tables/columns, migrations (db:generate/db:push), or DB query helpers.
---

# DB Schema & Migrations

SQLite + Drizzle ORM. The DB file is `db.sqlite` at the repo root (a working file is required for `npm run build`).

## Golden rules

- **Edit `src/lib/db/schema.ts` only.** It is the single source of truth (`drizzle.config.ts`: `dialect: 'sqlite'`, `schema: ./src/lib/db/schema.ts`, `out: ./drizzle`).
- **Never hand-write or hand-edit files in `drizzle/`.** They are generated SQL migrations. The one escape hatch is SQL drizzle cannot derive from the schema (see the `DROP COLUMN` note below): `drizzle-kit generate --custom --name <name>` emits an empty stub to write into, and the next `db:generate` still diffs against the schema normally.

## Workflow

1. Edit `src/lib/db/schema.ts` (add/change a table or column using Drizzle's `sqliteTable` builders).
2. Run `npm run db:generate` (`drizzle-kit generate`) → emits a new numbered migration in `drizzle/` (e.g. `0010_*.sql`). Commit the generated file alongside the schema change.
3. Apply with `npm run db:push` (`drizzle-kit migrate && drizzle-kit push`). `npm run build` runs `db:push` first, so a build also applies pending migrations. `src/lib/db/migrate.ts` runs the migrator against the `drizzle/` folder at startup.

## Where things live

- `src/lib/db/schema.ts` — tables (chats, messages, `app_settings`, workspaces, scheduled tasks, etc.).
- `src/lib/db/index.ts` — the `db` client (default export).
- `src/lib/db/queries.ts`, `chatSearch.ts`, `messageLookup.ts` — query helpers; add new queries here rather than inlining raw Drizzle in routes/components.
- `drizzle/` — generated migrations (`NNNN_name.sql`); do not touch by hand.

## Verifying a migration

`npm run test:unit` replays `drizzle/` onto an empty database (`src/lib/db/migrations.test.ts`) and asserts the result matches the newest snapshot. Run it after every `db:generate` — a developer's `db.sqlite` is maintained by `drizzle-kit push`, so it is **not** the database a new install gets, and the e2e suite builds its DB with `push` too. A migration can pass both and still break every new install.

The trap that motivated it: SQLite refuses `DROP COLUMN` while an index references the column. Indexes created by old migrations but never declared in `schema.ts` (e.g. `chats_scheduled_run_viewed_idx` from `0004`) survive on migrate-built databases and are pruned from push-built ones — so the drop works locally and fails on a fresh replay. Drop the index in a `--custom` migration ordered before the generated `DROP COLUMN`, and backfill anything the column still holds in that same migration: once the drop lands, the data is unrecoverable.

## Notes

- New settings usually do **not** need a schema change — they go in the `app_settings` key/value table via the allowlist (see the `yaawc-settings-persistence` skill).
- Client-side server-state reads go through TanStack Query hooks in `src/lib/hooks/api/` (see CLAUDE.md "Data Fetching"), not direct DB access.

Related: `yaawc-settings-persistence`, `yaawc-api-endpoints`.
