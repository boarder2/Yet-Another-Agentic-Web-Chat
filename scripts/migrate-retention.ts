/**
 * One-shot schema migration for the retention feature.
 *
 * Use this to convert a standalone SQLite database before or after moving it
 * into the container. The runtime container now runs the same migration on
 * startup via `src/lib/db/migrate.ts`.
 *
 * Usage:
 *   npx tsx scripts/migrate-retention.ts
 *   DB_PATH=/path/to/db.sqlite npx tsx scripts/migrate-retention.ts
 */
import Database from 'better-sqlite3';
import path from 'path';
import { applyRetentionMigration } from '../src/lib/db/retentionMigration';

const dbPath =
  process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.sqlite');
console.log(`[migrate-retention] opening ${dbPath}`);
const db = new Database(dbPath);

applyRetentionMigration(db);
