import path from 'node:path';
import { WORKSPACE_FILES_ROOT } from '@/lib/dataDir';

export { WORKSPACE_FILES_ROOT };

const FILENAME_RE = /^[^/\\\0]+$/;

export function validateFilename(name: string): void {
  if (typeof name !== 'string') throw new Error('filename must be a string');
  if (name.length === 0 || name.length > 255)
    throw new Error('filename length out of range');
  if (name === '.' || name === '..') throw new Error('reserved filename');
  if (!FILENAME_RE.test(name))
    throw new Error('filename contains invalid characters');
  if (name.includes('..')) throw new Error('filename must not contain ..');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

function guard(resolved: string): string {
  if (!resolved.startsWith(WORKSPACE_FILES_ROOT + path.sep)) {
    throw new Error('blob path escape detected');
  }
  return resolved;
}

export function workspaceDir(workspaceId: string): string {
  if (!UUID_RE.test(workspaceId)) throw new Error('invalid workspaceId');
  return guard(path.resolve(WORKSPACE_FILES_ROOT, workspaceId));
}

export function fileDir(workspaceId: string, fileId: string): string {
  if (!UUID_RE.test(fileId)) throw new Error('invalid fileId');
  return guard(path.resolve(workspaceDir(workspaceId), fileId));
}

/**
 * Blobs are content-addressed *within* one file, never across files. The sha is
 * a version stamp, not an identity — two files with identical bytes get their
 * own copies, so no blob is ever shared and none needs a reference count.
 */
export function blobPath(
  workspaceId: string,
  fileId: string,
  sha256: string,
): string {
  if (!SHA256_RE.test(sha256)) throw new Error('invalid sha256');
  return guard(path.resolve(fileDir(workspaceId, fileId), sha256));
}

export function hasNulByte(bytes: Buffer): boolean {
  const limit = Math.min(bytes.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
