import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A developer's `db.sqlite` has been through `drizzle-kit push`, which prunes
 * objects the schema no longer declares — so it is not the database a new
 * install gets. Only replaying `drizzle/` onto an empty file exercises what
 * `migrate.ts` does on first boot (and `npm run build` in CI/Docker), where a
 * migration that is fine against a pushed DB can still be invalid.
 */
const replayOntoEmptyDb = () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaawc-migrations-'));
  cleanup = () => rmSync(dir, { recursive: true, force: true });
  const sqlite = new Database(join(dir, 'db.sqlite'));
  migrate(drizzle(sqlite), { migrationsFolder: 'drizzle' });
  return sqlite;
};

let cleanup = () => {};
afterEach(() => cleanup());

describe('drizzle migrations', () => {
  it('replay onto an empty database', () => {
    const sqlite = replayOntoEmptyDb();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('chats');
    expect(tables.map((t) => t.name)).toContain('map_cache');
  });

  it('creates the generated image indexes', () => {
    const sqlite = replayOntoEmptyDb();
    const indexes = sqlite
      .prepare("PRAGMA index_list('generated_images')")
      .all() as { name: string }[];

    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'generated_images_chat_idx',
        'generated_images_workspace_idx',
        'generated_images_message_idx',
      ]),
    );

    const mapCacheIndexes = sqlite
      .prepare("PRAGMA index_list('map_cache')")
      .all() as { name: string }[];
    expect(mapCacheIndexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['map_cache_expiry_idx', 'map_cache_kind_idx']),
    );
  });

  it('land on the schema the newest snapshot describes', () => {
    const sqlite = replayOntoEmptyDb();
    const journal = JSON.parse(
      readFileSync('drizzle/meta/_journal.json', 'utf8'),
    ) as { entries: { idx: number }[] };
    const latest = String(
      Math.max(...journal.entries.map((e) => e.idx)),
    ).padStart(4, '0');
    const snapshot = JSON.parse(
      readFileSync(`drizzle/meta/${latest}_snapshot.json`, 'utf8'),
    ) as { tables: Record<string, { columns: Record<string, unknown> }> };

    // Drift here means the migrations and the snapshot disagree, so a fresh
    // install starts on a schema `drizzle-kit push` would still want to change.
    for (const [name, table] of Object.entries(snapshot.tables)) {
      const columns = sqlite
        .prepare(`PRAGMA table_info(${JSON.stringify(name)})`)
        .all() as { name: string }[];
      expect({ [name]: columns.map((c) => c.name).sort() }).toEqual({
        [name]: Object.keys(table.columns).sort(),
      });
    }
  });
});
