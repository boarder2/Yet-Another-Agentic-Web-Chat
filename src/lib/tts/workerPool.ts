// Parent-side manager for the TTS worker process (src/lib/tts/ttsWorker.js).
//
// Spawns a single long-lived worker, lazily, and — on Linux — wraps it in `nice`
// and `taskset` so Kokoro's ONNX threads run at low priority on a restricted set
// of cores. That guarantees the Next.js server always has CPU headroom to keep
// serving requests while speech is being synthesized. The worker serializes its
// own jobs, so concurrent /api/tts requests queue instead of multiplying load.
//
// Tuning via env vars:
//   TTS_WORKER_DISABLED   — set to "1"/"true" to skip the worker (inline fallback)
//   TTS_WORKER_NICE       — `nice` increment, default "15" (0–19, higher = nicer)
//   TTS_RESERVED_CORES    — cores kept TTS-free for the server (default ~25%)
//   TTS_WORKER_CPUS       — explicit taskset cpu-list (e.g. "0-9"); overrides the above
//   TTS_WORKER_IDLE_MS    — kill the idle worker after N ms to reclaim RAM (default 600000)
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import type { SpeechSegment } from './speechify';

export const isWorkerDisabled = (): boolean =>
  /^(1|true|yes)$/i.test(process.env.TTS_WORKER_DISABLED ?? '');

interface ReadyMsg {
  type: 'ready';
}
interface ChunkMsg {
  type: 'chunk';
  id: number;
  data: Buffer | Uint8Array;
}
interface DoneMsg {
  type: 'done';
  id: number;
}
interface ErrorMsg {
  type: 'error';
  id: number;
  message: string;
}
type WorkerMsg = ReadyMsg | ChunkMsg | DoneMsg | ErrorMsg;

interface Job {
  push: (b: Buffer) => void;
  done: () => void;
  fail: (e: Error) => void;
}

let child: ChildProcess | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Job>();
let idleTimer: NodeJS.Timeout | null = null;

const resolveWorkerPath = (): string => {
  const candidates = [
    // Dev (`next dev`, cwd = repo root) and prod standalone overlay both keep
    // the worker at this path relative to the working directory.
    path.join(process.cwd(), 'src/lib/tts/ttsWorker.js'),
    path.join(process.cwd(), 'ttsWorker.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `TTS worker script not found (looked in: ${candidates.join(', ')})`,
    );
  }
  return found;
};

const commandExists = (bin: string): boolean => {
  try {
    return spawnSync('which', [bin], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

// Cores 0..(usable-1) are handed to TTS; the rest stay exclusively available to
// the server. Returns undefined when there aren't enough cores to bother.
const cpuSet = (): string | undefined => {
  const explicit = process.env.TTS_WORKER_CPUS?.trim();
  if (explicit) return explicit;

  const total = os.cpus().length;
  if (total <= 2) return undefined; // too few cores to carve out a reservation

  const reserved = process.env.TTS_RESERVED_CORES
    ? Math.max(0, parseInt(process.env.TTS_RESERVED_CORES, 10) || 0)
    : Math.max(1, Math.ceil(total / 4));

  const usable = total - reserved;
  if (usable < 1 || usable >= total) return undefined;
  return `0-${usable - 1}`;
};

// Build the spawn command, wrapping node in `nice`/`taskset` where available.
// nice/taskset exec node in place, preserving the IPC fd and env, so the IPC
// channel still connects through the wrapper chain.
const buildSpawn = (workerPath: string): { cmd: string; args: string[] } => {
  let cmd = process.execPath;
  let args = [workerPath];

  if (process.platform !== 'linux') return { cmd, args };

  const cpus = cpuSet();
  if (cpus && commandExists('taskset')) {
    args = ['-c', cpus, cmd, ...args];
    cmd = 'taskset';
  }

  const nice = (process.env.TTS_WORKER_NICE ?? '15').trim();
  if (nice && nice !== '0' && commandExists('nice')) {
    args = ['-n', nice, cmd, ...args];
    cmd = 'nice';
  }

  return { cmd, args };
};

const clearIdleTimer = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

// Reclaim the worker's ~200MB resident model when nothing is in flight.
const scheduleIdleShutdown = () => {
  clearIdleTimer();
  const ms = process.env.TTS_WORKER_IDLE_MS
    ? parseInt(process.env.TTS_WORKER_IDLE_MS, 10)
    : 600_000;
  if (!ms || ms <= 0 || pending.size > 0) return;
  idleTimer = setTimeout(() => {
    if (pending.size === 0 && child) {
      child.kill();
    }
  }, ms);
  idleTimer.unref?.();
};

const routeMessage = (m: WorkerMsg) => {
  if (m.type === 'ready') return; // handled during ensureChild
  const job = pending.get(m.id);
  if (!job) return; // unknown/cancelled job — ignore stray chunks
  if (m.type === 'chunk') {
    job.push(Buffer.from(m.data));
  } else if (m.type === 'done') {
    pending.delete(m.id);
    job.done();
    scheduleIdleShutdown();
  } else if (m.type === 'error') {
    pending.delete(m.id);
    job.fail(new Error(m.message));
    scheduleIdleShutdown();
  }
};

const ensureChild = (): Promise<void> => {
  if (child && ready) return ready;

  const workerPath = resolveWorkerPath();
  const { cmd, args } = buildSpawn(workerPath);

  const proc = spawn(cmd, args, {
    // fd3 = IPC; stdout/stderr inherited so worker logs land in the server log.
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    serialization: 'advanced',
    env: process.env,
  });
  child = proc;

  ready = new Promise<void>((resolve, reject) => {
    const onReady = (m: WorkerMsg) => {
      if (m?.type === 'ready') {
        proc.off('message', onReady);
        resolve();
      }
    };
    proc.on('message', onReady);
    proc.once('error', reject);
    proc.once('exit', () =>
      reject(new Error('TTS worker exited before becoming ready')),
    );
  });

  proc.on('message', routeMessage as (m: unknown) => void);
  proc.on('exit', (code) => {
    const err = new Error(`TTS worker exited (code ${code})`);
    for (const job of pending.values()) job.fail(err);
    pending.clear();
    clearIdleTimer();
    if (child === proc) {
      child = null;
      ready = null;
    }
  });

  return ready;
};

/**
 * Synthesize speech segments in the worker process, yielding raw 32-bit float PCM
 * bytes (little-endian, 24kHz mono) chunk by chunk, with silence spliced between
 * segments. `voice` must already be validated by the caller. Throws if the worker
 * is unavailable (caller may fall back).
 */
export async function* synthesizeViaWorker(
  segments: SpeechSegment[],
  voice: string,
  speed: number,
): AsyncGenerator<Buffer> {
  await ensureChild();
  clearIdleTimer();

  const id = nextId++;
  const chunks: Buffer[] = [];
  let resolveNext: (() => void) | null = null;
  let finished = false;
  let error: Error | null = null;

  const wake = () => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  pending.set(id, {
    push: (b) => {
      chunks.push(b);
      wake();
    },
    done: () => {
      finished = true;
      wake();
    },
    fail: (e) => {
      error = e;
      finished = true;
      wake();
    },
  });

  child!.send({ type: 'job', id, segments, voice, speed });

  try {
    while (true) {
      if (chunks.length) {
        yield chunks.shift()!;
        continue;
      }
      if (error) throw error;
      if (finished) return;
      await new Promise<void>((res) => {
        resolveNext = res;
      });
    }
  } finally {
    // If the consumer stopped early (e.g. user hit stop), abandon the job so the
    // worker stops synthesizing instead of finishing into the void.
    if (pending.has(id)) {
      pending.delete(id);
      child?.send?.({ type: 'cancel', id });
      scheduleIdleShutdown();
    }
  }
}
