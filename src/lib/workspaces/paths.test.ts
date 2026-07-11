import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { blobPath, fileDir, workspaceDir, WORKSPACE_FILES_ROOT } from './paths';

const WS = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const SHA = 'a'.repeat(64);

describe('blobPath', () => {
  it('nests the blob under its workspace and file', () => {
    expect(blobPath(WS, FILE, SHA)).toBe(
      path.join(WORKSPACE_FILES_ROOT, WS, FILE, SHA),
    );
  });

  it('rejects a sha that is not 64 lowercase hex chars', () => {
    for (const bad of [
      '',
      'xyz',
      'A'.repeat(64),
      'a'.repeat(63),
      '../../etc',
    ]) {
      expect(() => blobPath(WS, FILE, bad)).toThrow('invalid sha256');
    }
  });

  it('rejects ids that are not uuids, including traversal attempts', () => {
    expect(() => blobPath('../escape', FILE, SHA)).toThrow(
      'invalid workspaceId',
    );
    expect(() => blobPath(WS, '../escape', SHA)).toThrow('invalid fileId');
    expect(() => blobPath(WS, '..', SHA)).toThrow('invalid fileId');
    expect(() => workspaceDir('/etc/passwd')).toThrow('invalid workspaceId');
    expect(() => fileDir(WS, 'not-a-uuid')).toThrow('invalid fileId');
  });

  it('keeps every derived path inside the blob root', () => {
    for (const p of [
      workspaceDir(WS),
      fileDir(WS, FILE),
      blobPath(WS, FILE, SHA),
    ]) {
      expect(p.startsWith(WORKSPACE_FILES_ROOT + path.sep)).toBe(true);
    }
  });
});
