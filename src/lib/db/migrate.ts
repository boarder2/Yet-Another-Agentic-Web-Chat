import db, { sqlite } from './';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { applyRetentionMigration } from './retentionMigration';

migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
applyRetentionMigration(sqlite);
