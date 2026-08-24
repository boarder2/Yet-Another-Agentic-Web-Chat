import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

export interface PagerResult {
  status: number | null;
  error?: Error;
}

export interface Pager {
  open(command: string, args: readonly string[], cwd: string): PagerResult;
}

export function createPager(): Pager {
  return {
    open(command, args, cwd) {
      try {
        const result = spawnSync(command, [...args], {
          cwd,
          stdio: 'inherit',
        });
        return {
          status: result.status,
          error: result.error,
        };
      } catch (error) {
        return {
          status: null,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}

export function writeOwnedLogHeader(
  path: string,
  cwd: string,
  dataDir: string,
  now = new Date(),
): void {
  const header = [
    `=== YAAWC dev run started ${now.toISOString()} ===`,
    `cwd: ${cwd}`,
    `DATA_DIR: ${dataDir}`,
    'command: npm run dev',
    '=== application output ===',
    '',
  ].join('\n');
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    chmodSync(path, 0o600);
    writeSync(fd, header, undefined, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function logExists(path: string): boolean {
  return existsSync(path);
}

export function readLogTail(
  path: string,
  maxLines = 40,
  maxBytes = 6_000,
): string | null {
  try {
    const content = readFileSync(path, 'utf8');
    const lines = content.split(/\r?\n/);
    const tail = lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
    if (Buffer.byteLength(tail, 'utf8') <= maxBytes) return tail;
    const bytes = Buffer.from(tail, 'utf8');
    return `…${bytes.subarray(bytes.length - maxBytes).toString('utf8')}`;
  } catch {
    return null;
  }
}

export function actionableLogMessage(
  path: string,
  reason: string,
  tail = readLogTail(path, 25, 4_000),
): string {
  const lines = [`${reason} See ${path} or run /app:logs.`];
  if (tail) lines.push(`Last log lines:\n${tail}`);
  return lines.join('\n');
}

export function pagerArgs(path: string): readonly string[] {
  return ['+G', path];
}
