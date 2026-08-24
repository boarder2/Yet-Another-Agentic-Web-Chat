import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  actionableLogMessage,
  logExists,
  pagerArgs,
  readLogTail,
  writeOwnedLogHeader,
} from './logs.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('owned log handling', () => {
  it('truncates and rewrites a user-only run header', () => {
    const root = mkdtempSync(join(tmpdir(), 'yaawc-run-app-log-'));
    roots.push(root);
    const path = join(root, 'dev.log');
    writeOwnedLogHeader(
      path,
      root,
      join(root, 'data'),
      new Date('2026-01-02T03:04:05.000Z'),
    );
    expect(readFileSync(path, 'utf8')).toContain(
      '=== YAAWC dev run started 2026-01-02T03:04:05.000Z ===',
    );
    chmodSync(path, 0o644);
    writeOwnedLogHeader(path, root, join(root, 'data'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(logExists(path)).toBe(true);
  });

  it('refuses to follow a pre-existing log symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'yaawc-run-app-log-'));
    roots.push(root);
    const target = join(root, 'target');
    const path = join(root, 'dev.log');
    writeFileSync(target, 'keep');
    symlinkSync(target, path);

    expect(() => writeOwnedLogHeader(path, root, join(root, 'data'))).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('keep');
  });

  it('keeps actionable failure output bounded to a log tail', () => {
    const root = mkdtempSync(join(tmpdir(), 'yaawc-run-app-log-'));
    roots.push(root);
    const path = join(root, 'dev.log');
    writeOwnedLogHeader(path, root, join(root, 'data'));
    expect(readLogTail(path, 2)).toContain('application output');
    expect(actionableLogMessage(path, 'startup failed')).toContain('/app:logs');
  });
});

it('opens less at the end without embedding log content in command arguments', () => {
  expect(pagerArgs('/tmp/yaawc-dev.log')).toEqual(['+G', '/tmp/yaawc-dev.log']);
});
