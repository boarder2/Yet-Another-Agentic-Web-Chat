import Database from 'better-sqlite3';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) {
  console.error('seed-settings: DATA_DIR is not set');
  process.exit(1);
}

const DB_PATH = path.join(DATA_DIR, 'db.sqlite');

try {
  const db = new Database(DB_PATH);

  // Verify the table exists — drizzle-kit push should have created it
  const tableCheck = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'",
    )
    .get();
  if (!tableCheck) {
    console.error('seed-settings: app_settings table not found in', DB_PATH);
    process.exit(1);
  }

  const upsert = db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
  );
  // Drizzle `mode: 'timestamp'` stores Unix seconds (not ms).
  const now = Math.floor(Date.now() / 1000);

  const rows = [
    ['chatModelProvider', 'test'],
    ['chatModel', 'test-direct'],
    ['systemModelProvider', 'test'],
    ['systemModel', 'test-direct'],
    ['memoryModelProvider', 'test'],
    ['memoryModel', 'test-direct'],
    ['embeddingModelProvider', 'test'],
    ['embeddingModel', 'test-embed'],
  ];

  const insertMany = db.transaction(() => {
    for (const [key, value] of rows) {
      upsert.run(key, value, now);
    }
  });
  insertMany();

  db.close();
  console.log('seed-settings: test model settings seeded');
} catch (err) {
  console.error('seed-settings: failed to seed settings', err.message);
  process.exit(1);
}
