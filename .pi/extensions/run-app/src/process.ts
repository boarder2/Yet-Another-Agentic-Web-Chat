import { execFile } from 'node:child_process';
import {
  closeSync,
  constants,
  openSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import { promisify } from 'node:util';
import { spawn, type ChildProcess } from 'node:child_process';
import { OWNERSHIP_TOKEN_ENV } from './constants.ts';
import type { ProcessIdentity, ProcessInspector } from './ownership.ts';

const execFileAsync = promisify(execFile);

export interface SpawnedProcess {
  pid: number;
  pgid: number;
  hasExited(): boolean;
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): () => void;
}

export interface DevSpawnOptions {
  cwd: string;
  dataDir: string;
  token: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessRuntime extends ProcessInspector {
  spawnDev(options: DevSpawnOptions): SpawnedProcess;
}

export function createProcessRuntime(): ProcessRuntime {
  return {
    spawnDev: spawnDev,
    inspect: inspectProcess,
    controllerAlive: async (pid) => pidAlive(pid),
    groupAlive: async (pgid) => groupAlive(pgid),
    signalGroup: (pgid, signal) => process.kill(-pgid, signal),
  };
}

function spawnDev(options: DevSpawnOptions): SpawnedProcess {
  const logFd = openSync(
    options.logPath,
    constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
    0o600,
  );
  let child: ChildProcess;
  try {
    child = spawn('npm', ['run', 'dev'], {
      cwd: options.cwd,
      detached: true,
      env: {
        ...(options.env ?? process.env),
        DATA_DIR: options.dataDir,
        [OWNERSHIP_TOKEN_ENV]: options.token,
      },
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  if (!child.pid) {
    child.kill();
    throw new Error('npm run dev did not provide a process PID.');
  }
  child.unref();
  return wrapChild(child);
}

function wrapChild(child: ChildProcess): SpawnedProcess {
  let exited = false;
  const listeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >();
  child.once('exit', (code, signal) => {
    exited = true;
    for (const listener of listeners) listener(code, signal);
    listeners.clear();
  });
  child.once('error', () => {
    exited = true;
  });

  return {
    pid: child.pid as number,
    pgid: child.pid as number,
    hasExited: () => exited,
    onExit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function inspectProcess(pid: number): Promise<ProcessIdentity | null> {
  if (!pidAlive(pid)) return null;
  if (process.platform === 'linux') return inspectLinux(pid);
  return inspectWithPs(pid);
}

function inspectLinux(pid: number): ProcessIdentity | null {
  const proc = `/proc/${pid}`;
  try {
    const command = readFileSync(`${proc}/cmdline`, 'utf8')
      .replaceAll('\0', ' ')
      .trim();
    const cwd = readlinkSync(`${proc}/cwd`);
    const environment = readFileSync(`${proc}/environ`, 'utf8');
    const token = environment
      .split('\0')
      .find((entry) => entry.startsWith(`${OWNERSHIP_TOKEN_ENV}=`))
      ?.slice(OWNERSHIP_TOKEN_ENV.length + 1);
    const stat = readFileSync(`${proc}/stat`, 'utf8');
    const closing = stat.lastIndexOf(')');
    const fields = closing >= 0 ? stat.slice(closing + 2).split(' ') : [];
    const pgid = Number(fields[2]);
    return {
      pid,
      command,
      cwd,
      token,
      tokenReadable: true,
      pgid: Number.isSafeInteger(pgid) ? pgid : undefined,
    };
  } catch {
    return null;
  }
}

async function inspectWithPs(pid: number): Promise<ProcessIdentity | null> {
  try {
    const [{ stdout: processText }, { stdout: environmentText }] =
      await Promise.all([
        execFileAsync('ps', [
          '-ww',
          '-o',
          'pid=,pgid=,command=',
          '-p',
          String(pid),
        ]),
        execFileAsync('ps', ['eww', '-p', String(pid)]),
      ]);
    const line = processText.trim();
    const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) return null;
    const tokenMatch = new RegExp(`${OWNERSHIP_TOKEN_ENV}=([^\\s]+)`).exec(
      environmentText,
    );
    return {
      pid: Number(match[1]),
      pgid: Number(match[2]),
      command: match[3] ?? '',
      token: tokenMatch?.[1],
      tokenReadable: true,
    };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function groupAlive(pgid: number): boolean {
  if (!Number.isSafeInteger(pgid) || pgid <= 0) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
