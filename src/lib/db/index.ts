import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { DB_PATH } from '../dataDir';

export const sqlite = new Database(DB_PATH);
// Enforce foreign keys so ON DELETE CASCADE (approval_requests, run_events)
// fires. better-sqlite3 leaves this OFF by default and it is per-connection.
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, {
  schema: schema,
});

export default db;
