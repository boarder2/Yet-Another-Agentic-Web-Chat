import Database from 'better-sqlite3';
import path from 'path';
import { LEGACY_CHAT_ID, LEGACY_CONTENT } from './legacy-fixture-constants.mjs';

// Seeds one pre-migration-shaped chat/message row directly via SQL — content
// set, `sanitized_content` left NULL — simulating a row written before the
// sanitizedContent backfill existed. No app write path can produce this state
// anymore (every writer derives sanitizedContent in the same operation), so
// this is the only way to exercise the boot-time backfill end-to-end. Run
// directly via `node` from playwright.config.ts's webServer command, before
// the server starts, so the backfill's normal boot sequence
// (src/lib/db/backfillSanitizedContent.ts) picks it up like any other
// unprocessed legacy row.

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) {
  console.error('seed-legacy-message: DATA_DIR is not set');
  process.exit(1);
}

const DB_PATH = path.join(DATA_DIR, 'db.sqlite');

try {
  const db = new Database(DB_PATH);

  const tableCheck = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'",
    )
    .get();
  if (!tableCheck) {
    console.error('seed-legacy-message: messages table not found in', DB_PATH);
    process.exit(1);
  }

  db.prepare(
    'INSERT INTO chats (id, title, createdAt, focusMode) VALUES (?, ?, ?, ?)',
  ).run(LEGACY_CHAT_ID, 'Legacy backfill fixture', Date.now(), 'webSearch');

  db.prepare(
    'INSERT INTO messages (content, sanitized_content, chatId, messageId, type, metadata) VALUES (?, NULL, ?, ?, ?, ?)',
  ).run(LEGACY_CONTENT, LEGACY_CHAT_ID, 'legacy-msg-1', 'assistant', '{}');

  db.close();
  console.log('seed-legacy-message: legacy fixture row seeded');
} catch (err) {
  console.error('seed-legacy-message: failed to seed legacy row', err.message);
  process.exit(1);
}
