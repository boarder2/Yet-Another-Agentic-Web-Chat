import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { workspaceFiles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  WORKSPACE_FILES_ROOT,
  blobPath,
  fileDir,
  validateFilename,
  hasNulByte,
} from './paths';

export type FileRow = typeof workspaceFiles.$inferSelect;

/** A write lost the compare-and-swap: the file changed since it was read. */
export class ConflictError extends Error {
  constructor(readonly currentSha: string) {
    super('file changed since it was read');
    this.name = 'ConflictError';
  }
}

/**
 * Write bytes into the file's own directory and return their sha. The blob is
 * staged only — nothing references it until the row UPDATE commits, so a crash
 * here leaks an orphan rather than dangling a row.
 */
async function stageBlob(
  workspaceId: string,
  fileId: string,
  buf: Buffer,
): Promise<string> {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const target = blobPath(workspaceId, fileId, sha256);
  await fs.mkdir(fileDir(workspaceId, fileId), { recursive: true });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, target);
  return sha256;
}

const SNIFF_BYTES = 8192;
const binaryByShaCache = new Map<string, boolean>();
const BINARY_CACHE_MAX = 1024;

/** Cached by sha: binary-ness is a property of the content, not of the file. */
async function sniffIsBinary(row: FileRow): Promise<boolean> {
  const hit = binaryByShaCache.get(row.sha256);
  if (hit !== undefined) return hit;
  let isBinary = false;
  try {
    const fh = await fs.open(
      blobPath(row.workspaceId, row.id, row.sha256),
      'r',
    );
    try {
      const buf = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0);
      isBinary = hasNulByte(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  } catch {
    // Missing blob → treat as non-binary so UI doesn't suppress controls
    isBinary = false;
  }
  if (binaryByShaCache.size >= BINARY_CACHE_MAX) {
    const first = binaryByShaCache.keys().next().value;
    if (first !== undefined) binaryByShaCache.delete(first);
  }
  binaryByShaCache.set(row.sha256, isBinary);
  return isBinary;
}

export async function listFiles(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspaceId));
  return Promise.all(
    rows.map(async (r) => ({ ...r, isBinary: await sniffIsBinary(r) })),
  );
}

export async function getFile(workspaceId: string, fileId: string) {
  const [row] = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.id, fileId),
      ),
    );
  return row ?? null;
}

export async function getFileByName(workspaceId: string, name: string) {
  validateFilename(name);
  const [row] = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.name, name),
      ),
    );
  return row ?? null;
}

export async function readFileBytes(
  workspaceId: string,
  fileId: string,
): Promise<{ row: FileRow; bytes: Buffer } | null> {
  const row = await getFile(workspaceId, fileId);
  if (!row) return null;
  const bytes = await fs.readFile(
    blobPath(row.workspaceId, row.id, row.sha256),
  );
  return { row, bytes };
}

export async function createFile(opts: {
  workspaceId: string;
  name: string;
  mime?: string | null;
  bytes: Buffer;
}) {
  validateFilename(opts.name);
  // The blob path is keyed by file id, so the id must exist before the bytes do.
  const id = crypto.randomUUID();
  const sha256 = await stageBlob(opts.workspaceId, id, opts.bytes);
  const [row] = await db
    .insert(workspaceFiles)
    .values({
      id,
      workspaceId: opts.workspaceId,
      name: opts.name,
      mime: opts.mime ?? null,
      size: opts.bytes.length,
      sha256,
    })
    .returning();
  return row;
}

/**
 * Compare-and-swap write. `expectedSha` is mandatory: every caller must prove it
 * read the version it is replacing, so a concurrent write can never be silently
 * lost. The row UPDATE is the commit point — the new blob is staged before it and
 * the old one is dropped after it.
 */
export async function replaceFile(opts: {
  workspaceId: string;
  fileId: string;
  bytes: Buffer;
  expectedSha: string;
  mime?: string | null;
}) {
  const existing = await getFile(opts.workspaceId, opts.fileId);
  if (!existing) return null;

  const sha256 = await stageBlob(opts.workspaceId, opts.fileId, opts.bytes);
  const [row] = await db
    .update(workspaceFiles)
    .set({
      sha256,
      size: opts.bytes.length,
      mime: opts.mime ?? existing.mime,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceFiles.id, opts.fileId),
        eq(workspaceFiles.workspaceId, opts.workspaceId),
        eq(workspaceFiles.sha256, opts.expectedSha),
      ),
    )
    .returning();

  if (!row) {
    // Lost the swap. The staged blob is only reachable from the sha we failed to
    // publish, so drop it — unless the winner published the same bytes.
    const current = await getFile(opts.workspaceId, opts.fileId);
    if (current && current.sha256 !== sha256) {
      await unlinkBlob(opts.workspaceId, opts.fileId, sha256);
    }
    throw new ConflictError(current?.sha256 ?? opts.expectedSha);
  }

  if (sha256 !== opts.expectedSha) {
    await unlinkBlob(opts.workspaceId, opts.fileId, opts.expectedSha);
  }
  return row;
}

export async function deleteFile(workspaceId: string, fileId: string) {
  const existing = await getFile(workspaceId, fileId);
  if (!existing) return false;
  await db.delete(workspaceFiles).where(eq(workspaceFiles.id, fileId));
  await fs.rm(fileDir(workspaceId, fileId), { recursive: true, force: true });
  return true;
}

/** Names one blob rather than sweeping the dir, so a concurrent stage survives. */
async function unlinkBlob(workspaceId: string, fileId: string, sha256: string) {
  try {
    await fs.unlink(blobPath(workspaceId, fileId, sha256));
  } catch {
    /* already gone */
  }
}

export { WORKSPACE_FILES_ROOT };
