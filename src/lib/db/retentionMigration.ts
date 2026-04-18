type SqliteDatabaseLike = {
  exec(sql: string): unknown;
  pragma(name: string, value?: unknown): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): Array<Record<string, unknown>>;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
};

function getColumns(db: SqliteDatabaseLike, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

function columnExists(
  db: SqliteDatabaseLike,
  table: string,
  column: string,
): boolean {
  return getColumns(db, table).includes(column);
}

function parseCreatedAt(raw: string): number {
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) {
    console.warn(
      `[migrate-retention] unparseable createdAt "${raw}", using Date.now()`,
    );
    return Date.now();
  }
  return ms;
}

export function applyRetentionMigration(db: SqliteDatabaseLike): void {
  db.pragma('foreign_keys = OFF');
  db.pragma('journal_mode = WAL');

  db.exec('BEGIN');
  try {
    const chatColumns = getColumns(db, 'chats');
    const hasChatsTable = chatColumns.length > 0;
    const hasCreatedAt = chatColumns.includes('createdAt');
    const createdAtProbe = hasCreatedAt
      ? (db
          .prepare(`SELECT typeof(createdAt) AS t FROM chats LIMIT 1`)
          .get() as { t?: string } | undefined)
      : undefined;

    if (hasChatsTable && hasCreatedAt && createdAtProbe?.t === 'text') {
      console.log(
        '[migrate-retention] converting chats.createdAt from TEXT to INTEGER',
      );

      const rows = db.prepare(`SELECT * FROM chats`).all() as Array<
        Record<string, unknown>
      >;
      console.log(`[migrate-retention] ${rows.length} chats to migrate`);

      const hadPinnedColumn = chatColumns.includes('pinned');

      db.exec(`DROP INDEX IF EXISTS chats_scheduled_run_viewed_idx`);
      db.exec(`DROP INDEX IF EXISTS chats_pinned_idx`);
      db.exec(`ALTER TABLE chats RENAME TO chats_old`);

      db.exec(`
        CREATE TABLE chats (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          focusMode TEXT NOT NULL,
          files TEXT DEFAULT '[]',
          is_private INTEGER NOT NULL DEFAULT 0,
          scheduled_task_id TEXT,
          scheduled_run_viewed INTEGER,
          pinned INTEGER NOT NULL DEFAULT 0
        );
      `);

      const insert = db.prepare(`
        INSERT INTO chats (
          id,
          title,
          createdAt,
          focusMode,
          files,
          is_private,
          scheduled_task_id,
          scheduled_run_viewed,
          pinned
        )
        VALUES (
          @id,
          @title,
          @createdAt,
          @focusMode,
          @files,
          @is_private,
          @scheduled_task_id,
          @scheduled_run_viewed,
          @pinned
        )
      `);

      for (const row of rows) {
        insert.run({
          id: row.id,
          title: row.title,
          createdAt: parseCreatedAt(String(row.createdAt)),
          focusMode: row.focusMode,
          files: row.files ?? '[]',
          is_private: row.is_private ?? 0,
          scheduled_task_id: row.scheduled_task_id ?? null,
          scheduled_run_viewed: row.scheduled_run_viewed ?? null,
          pinned: hadPinnedColumn ? (row.pinned ?? 0) : 0,
        });
      }

      db.exec(`DROP TABLE chats_old`);
      console.log(
        `[migrate-retention] migrated ${rows.length} chats successfully`,
      );
    } else if (hasChatsTable && hasCreatedAt) {
      console.log(
        '[migrate-retention] chats.createdAt already INTEGER — skipping conversion',
      );
    } else if (hasChatsTable) {
      console.log(
        '[migrate-retention] chats table missing createdAt — skipping conversion',
      );
    }

    if (hasChatsTable && !columnExists(db, 'chats', 'pinned')) {
      console.log('[migrate-retention] adding pinned column to chats');
      db.exec(`ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
    }

    if (hasChatsTable) {
      db.exec(
        `CREATE INDEX IF NOT EXISTS chats_scheduled_run_viewed_idx ON chats(scheduled_run_viewed)`,
      );
      db.exec(`CREATE INDEX IF NOT EXISTS chats_pinned_idx ON chats(pinned)`);
    }

    const hasScheduledTasksTable = getColumns(db, 'scheduled_tasks').length > 0;

    if (
      hasScheduledTasksTable &&
      !columnExists(db, 'scheduled_tasks', 'retention_mode')
    ) {
      console.log(
        '[migrate-retention] adding retention_mode to scheduled_tasks',
      );
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN retention_mode TEXT`);
    }

    if (
      hasScheduledTasksTable &&
      !columnExists(db, 'scheduled_tasks', 'retention_value')
    ) {
      console.log(
        '[migrate-retention] adding retention_value to scheduled_tasks',
      );
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN retention_value INTEGER`);
    }

    db.exec('COMMIT');
    console.log('[migrate-retention] done ✓');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('[migrate-retention] FAILED, rolled back:', error);
    throw error;
  }
}
