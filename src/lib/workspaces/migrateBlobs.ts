import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import db from '@/lib/db';
import { workspaceFiles } from '@/lib/db/schema';
import { WORKSPACE_FILES_ROOT, blobPath, fileDir } from './paths';

/** Legacy layout: `<root>/<first 2 chars of sha>/<sha>`, shared across files. */
const SHARD_RE = /^[0-9a-f]{2}$/;

function legacyShards(): string[] {
  return fs
    .readdirSync(WORKSPACE_FILES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SHARD_RE.test(d.name))
    .map((d) => d.name);
}

/**
 * One-time, idempotent boot migration: move globally deduplicated blobs into the
 * per-file layout (`<root>/<workspaceId>/<fileId>/<sha>`). Blobs are hardlinked,
 * so a sha shared by N files costs no extra bytes and the kernel refcounts the
 * unlinking for us; filesystems that reject links (EXDEV across a Docker volume
 * mount, EPERM on some overlays) fall back to a copy.
 *
 * The legacy tree is removed only once every row has been placed. Deleting it
 * after a partial failure would destroy blobs nothing else points at — the one
 * unrecoverable outcome here — so a single failure leaves it for the next boot.
 */
export function migrateWorkspaceBlobs(): void {
  const shards = legacyShards();
  if (shards.length === 0) return; // fresh install, or already migrated

  const rows = db
    .select({
      id: workspaceFiles.id,
      workspaceId: workspaceFiles.workspaceId,
      sha256: workspaceFiles.sha256,
    })
    .from(workspaceFiles)
    .all();

  let placed = 0;
  let copied = 0;
  let failed = 0;
  let orphanedRows = 0;

  for (const row of rows) {
    let dest: string;
    try {
      dest = blobPath(row.workspaceId, row.id, row.sha256);
    } catch {
      failed++; // unparseable ids/sha — leave the legacy blob alone
      continue;
    }
    if (fs.existsSync(dest)) {
      placed++;
      continue;
    }

    const src = path.join(
      WORKSPACE_FILES_ROOT,
      row.sha256.slice(0, 2),
      row.sha256,
    );
    if (!fs.existsSync(src)) {
      // The row already points at nothing — the bug this migration accompanies
      // could delete a live blob. Retaining the legacy tree cannot bring it back.
      orphanedRows++;
      continue;
    }

    try {
      fs.mkdirSync(fileDir(row.workspaceId, row.id), { recursive: true });
      try {
        fs.linkSync(src, dest);
      } catch {
        fs.copyFileSync(src, dest);
        copied++;
      }
      placed++;
    } catch (err) {
      failed++;
      console.error(`[workspaces] Failed to migrate blob for ${row.id}:`, err);
    }
  }

  if (failed > 0) {
    console.warn(
      `[workspaces] Migrated ${placed}/${rows.length} file blobs, ${failed} failed — ` +
        'keeping the legacy blob tree; migration will retry on next boot.',
    );
    return;
  }

  for (const shard of shards) {
    fs.rmSync(path.join(WORKSPACE_FILES_ROOT, shard), {
      recursive: true,
      force: true,
    });
  }
  console.log(
    `[workspaces] Migrated ${placed} file blobs to per-file storage` +
      `${copied > 0 ? ` (${copied} copied, links unsupported)` : ''}` +
      `${orphanedRows > 0 ? `; ${orphanedRows} file(s) had no blob on disk and stay broken` : ''}.`,
  );
}
