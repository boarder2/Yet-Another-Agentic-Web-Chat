import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { DB_PATH } from '../dataDir';

export const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite, {
  schema: schema,
});

export default db;
