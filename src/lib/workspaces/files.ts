import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { workspaceFiles } from '@/lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { WORKSPACE_FILES_ROOT, blobPath, validateFilename } from './paths';

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function writeBlob(buf: Buffer): Promise<string> {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const target = blobPath(sha256);
  await ensureDir(path.dirname(target));
  try {
    await fs.access(target);
  } catch {
    const tmp = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, target);
  }
  return sha256;
}

export async function listFiles(workspaceId: string) {
  return db
    .select()
    .from(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspaceId));
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
): Promise<{
  row: typeof workspaceFiles.$inferSelect;
  bytes: Buffer;
} | null> {
  const row = await getFile(workspaceId, fileId);
  if (!row) return null;
  const bytes = await fs.readFile(blobPath(row.sha256));
  return { row, bytes };
}

export async function createFile(opts: {
  workspaceId: string;
  name: string;
  mime?: string | null;
  bytes: Buffer;
}) {
  validateFilename(opts.name);
  const sha256 = await writeBlob(opts.bytes);
  const [row] = await db
    .insert(workspaceFiles)
    .values({
      workspaceId: opts.workspaceId,
      name: opts.name,
      mime: opts.mime ?? null,
      size: opts.bytes.length,
      sha256,
    })
    .returning();
  return row;
}

export async function replaceFile(opts: {
  workspaceId: string;
  fileId: string;
  bytes: Buffer;
  mime?: string | null;
}) {
  const existing = await getFile(opts.workspaceId, opts.fileId);
  if (!existing) return null;
  const sha256 = await writeBlob(opts.bytes);
  const [row] = await db
    .update(workspaceFiles)
    .set({
      sha256,
      size: opts.bytes.length,
      mime: opts.mime ?? existing.mime,
      updatedAt: new Date(),
    })
    .where(eq(workspaceFiles.id, opts.fileId))
    .returning();
  await maybeGcBlob(existing.sha256, existing.id);
  return row;
}

export async function deleteFile(workspaceId: string, fileId: string) {
  const existing = await getFile(workspaceId, fileId);
  if (!existing) return false;
  await db.delete(workspaceFiles).where(eq(workspaceFiles.id, fileId));
  await maybeGcBlob(existing.sha256, existing.id);
  return true;
}

async function maybeGcBlob(sha256: string, excludeFileId: string) {
  const refs = await db
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.sha256, sha256),
        ne(workspaceFiles.id, excludeFileId),
      ),
    );
  if (refs.length === 0) {
    try {
      await fs.unlink(blobPath(sha256));
    } catch {
      /* already gone */
    }
  }
}

export { WORKSPACE_FILES_ROOT };
