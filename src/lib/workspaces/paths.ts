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

export function blobPath(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('invalid sha256');
  const dir = sha256.slice(0, 2);
  const resolved = path.resolve(WORKSPACE_FILES_ROOT, dir, sha256);
  if (!resolved.startsWith(WORKSPACE_FILES_ROOT + path.sep)) {
    throw new Error('blob path escape detected');
  }
  return resolved;
}

export function hasNulByte(bytes: Buffer): boolean {
  const limit = Math.min(bytes.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
