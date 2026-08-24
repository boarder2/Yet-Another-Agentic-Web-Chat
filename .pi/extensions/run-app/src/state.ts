import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseAppState, type AppState } from './types.ts';

export function loadState(path: string): AppState | null {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    chmodSync(path, 0o600);
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parseAppState(parsed);
  } catch {
    return null;
  }
}

export function saveState(path: string, state: AppState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file was renamed or was never created.
    }
  }
}

export function discardState(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // A missing state file is already discarded.
  }
}
