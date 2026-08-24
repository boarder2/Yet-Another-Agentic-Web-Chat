import { parseSelectedPort, type HealthProbe } from './health.ts';

export class StartupCancelledError extends Error {
  constructor() {
    super('YAAWC startup cancelled.');
    this.name = 'StartupCancelledError';
  }
}

export class StartupTimeoutError extends Error {
  constructor() {
    super('YAAWC did not become healthy before the 90 second startup timeout.');
    this.name = 'StartupTimeoutError';
  }
}

export class StartupChildExitedError extends Error {
  constructor() {
    super(
      'The YAAWC dev process exited before its health endpoint became ready.',
    );
    this.name = 'StartupChildExitedError';
  }
}

export interface StartupReady {
  port: number;
  url: string;
  health: HealthProbe;
}

export interface StartupWaitOptions {
  signal: AbortSignal;
  timeoutMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isExited: () => boolean;
  readLog: () => string;
  urlForPort: (port: number) => string;
  probe: (url: string, signal: AbortSignal) => Promise<HealthProbe>;
}

export async function waitForReady(
  options: StartupWaitOptions,
): Promise<StartupReady> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const pollMs = options.pollMs ?? 250;
  const deadline = now() + options.timeoutMs;
  let port: number | null = null;

  while (now() < deadline) {
    if (options.signal.aborted) throw new StartupCancelledError();
    if (options.isExited()) throw new StartupChildExitedError();

    port = parseSelectedPort(options.readLog()) ?? port;
    if (port !== null) {
      const url = options.urlForPort(port);
      const health = await options.probe(url, options.signal);
      if (health.healthy) return { port, url, health };
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }

  if (options.signal.aborted) throw new StartupCancelledError();
  if (options.isExited()) throw new StartupChildExitedError();
  throw new StartupTimeoutError();
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
