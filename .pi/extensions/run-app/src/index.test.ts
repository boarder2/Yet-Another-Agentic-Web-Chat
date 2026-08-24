import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunAppExtension } from './index.ts';
import { loadState } from './state.ts';
import { stoppedState, type AppState } from './types.ts';
import type { ProcessRuntime, SpawnedProcess } from './process.ts';
import type { ProcessIdentity } from './ownership.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

interface TestContext {
  cwd: string;
  mode: 'rpc';
  hasUI: boolean;
  ui: {
    notify: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    theme: { fg: (color: string, text: string) => string };
    custom: ReturnType<typeof vi.fn>;
  };
}

interface Handler {
  (args: string, ctx: TestContext): Promise<void>;
}

interface EventHandler {
  (event: { reason: string }, ctx: TestContext): Promise<void> | void;
}

const instances: FakePi[] = [];

class FakePi {
  readonly commands = new Map<string, Handler>();
  readonly events = new Map<string, EventHandler>();
  readonly api = {
    registerCommand: (name: string, definition: { handler: Handler }) => {
      this.commands.set(name, definition.handler);
    },
    on: (name: string, handler: EventHandler) => {
      this.events.set(name, handler);
    },
  } as unknown as ExtensionAPI;

  constructor() {
    instances.push(this);
  }
}

function context(cwd: string): TestContext {
  return {
    cwd,
    mode: 'rpc',
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: { fg: (_color: string, text: string) => text },
      custom: vi.fn(),
    },
  };
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'yaawc-run-app-index-'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'next dev' } }),
  );
  writeFileSync(join(root, 'config.toml'), 'passphrase = "test"\n');
  return root;
}

function identity(pid: number, cwd: string, token: string): ProcessIdentity {
  return {
    pid,
    pgid: pid,
    command: 'npm run dev',
    cwd,
    token,
    tokenReadable: true,
  };
}

function fakeRuntime(
  root: string,
  options: {
    controllerAlive?: boolean;
    onSpawn?: (child: SpawnedProcess) => void;
  } = {},
): ProcessRuntime & { signals: string[] } {
  const signals: string[] = [];
  let child: SpawnedProcess | undefined;
  const runtime: ProcessRuntime & { signals: string[] } = {
    signals,
    spawnDev: (spawnOptions) => {
      const handle: SpawnedProcess = {
        pid: 41,
        pgid: 41,
        hasExited: () => false,
        onExit: () => () => undefined,
      };
      child = handle;
      writeFileSync(spawnOptions.logPath, '- Local: http://localhost:5008\n');
      options.onSpawn?.(handle);
      return handle;
    },
    inspect: async (pid) => (pid === 41 ? identity(41, root, 'token') : null),
    controllerAlive: async () => options.controllerAlive ?? false,
    groupAlive: async () => false,
    signalGroup: (_pgid, signal) => signals.push(signal),
  };
  void child;
  return runtime;
}

const roots: string[] = [];
afterEach(async () => {
  for (const pi of instances.splice(0)) {
    await pi.events.get('session_shutdown')?.(
      { reason: 'new' },
      context('/tmp'),
    );
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('argument-free commands and ownership', () => {
  it('fails clearly on Windows without spawning', async () => {
    const root = project();
    roots.push(root);
    const spawn = vi.fn();
    const pi = new FakePi();
    createRunAppExtension(pi.api, {
      statePath: join(root, '.state.json'),
      logPath: join(root, 'dev.log'),
      platform: 'win32',
      processRuntime: { ...fakeRuntime(root), spawnDev: spawn },
      env: {},
    });
    await pi.commands.get('app:start')?.('', context(root));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not start when an argument is supplied', async () => {
    const root = project();
    roots.push(root);
    const pi = new FakePi();
    const spawn = vi.fn();
    createRunAppExtension(pi.api, {
      statePath: join(root, '.state.json'),
      logPath: join(root, 'dev.log'),
      currentPid: 99,
      processRuntime: {
        ...fakeRuntime(root),
        spawnDev: spawn,
      },
      scan: vi.fn(async () => null),
      env: {},
    });

    await pi.commands.get('app:start')?.('unexpected', context(root));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('stops a strongly validated owned group when the health endpoint is unavailable', async () => {
    const root = project();
    roots.push(root);
    const path = join(root, '.state.json');
    const state: AppState = {
      ...stoppedState(root, join(root, 'dev.log')),
      lifecycle: 'running',
      ownership: 'owned',
      pid: 41,
      pgid: 41,
      ownershipToken: 'token',
      controllerPid: 99,
      port: 5008,
      url: 'http://localhost:5008',
      health: 'healthy',
    };
    writeFileSync(path, JSON.stringify(state));
    const runtime = fakeRuntime(root);
    const pi = new FakePi();
    createRunAppExtension(pi.api, {
      statePath: path,
      logPath: join(root, 'dev.log'),
      currentPid: 99,
      processRuntime: runtime,
      probe: async (url) => ({
        url,
        healthy: false,
        identified: false,
        status: null,
      }),
      env: {},
    });

    await pi.commands.get('app:stop')?.('', context(root));

    expect(runtime.signals).toEqual(['SIGTERM']);
  });

  it('refuses a live foreign controller before touching the app', async () => {
    const root = project();
    roots.push(root);
    const state: AppState = {
      ...stoppedState(root, join(root, 'dev.log')),
      lifecycle: 'running',
      ownership: 'owned',
      pid: 41,
      pgid: 41,
      ownershipToken: 'token',
      controllerPid: 77,
      port: 5008,
      url: 'http://localhost:5008',
      dataDir: join(root, 'data'),
    };
    writeFileSync(join(root, '.state.json'), JSON.stringify(state));
    const runtime = fakeRuntime(root, { controllerAlive: true });
    const scan = vi.fn(async () => null);
    const pi = new FakePi();
    createRunAppExtension(pi.api, {
      statePath: join(root, '.state.json'),
      logPath: join(root, 'dev.log'),
      currentPid: 99,
      processRuntime: runtime,
      scan,
      env: {},
    });

    await pi.commands.get('app:start')?.('', context(root));
    expect(scan).not.toHaveBeenCalled();
    expect(runtime.signals).toEqual([]);
  });
});

describe('session reconciliation', () => {
  it('does not restore or poll persisted external state automatically', async () => {
    const root = project();
    roots.push(root);
    const path = join(root, '.state.json');
    const external: AppState = {
      ...stoppedState(root, join(root, 'dev.log')),
      lifecycle: 'running',
      ownership: 'external',
      port: 5006,
      url: 'http://localhost:5006',
      health: 'healthy',
    };
    writeFileSync(path, JSON.stringify(external));
    const probe = vi.fn();
    const pi = new FakePi();
    const ctx = context(root);
    createRunAppExtension(pi.api, {
      statePath: path,
      logPath: join(root, 'dev.log'),
      processRuntime: fakeRuntime(root),
      probe,
      env: {},
    });

    await pi.events.get('session_start')?.({ reason: 'startup' }, ctx);

    expect(probe).not.toHaveBeenCalled();
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith('run-app', undefined);
  });
});

describe('start and stop transitions', () => {
  it('attaches healthy external YAAWC and never signals it', async () => {
    const root = project();
    roots.push(root);
    const runtime = fakeRuntime(root);
    const pi = new FakePi();
    const ctx = context(root);
    createRunAppExtension(pi.api, {
      statePath: join(root, '.state.json'),
      logPath: join(root, 'dev.log'),
      currentPid: 99,
      processRuntime: runtime,
      scan: async () => ({
        port: 5006,
        url: 'http://localhost:5006',
        healthy: true,
        identified: true,
        status: 200,
      }),
      probe: async (url) => ({
        url,
        healthy: true,
        identified: true,
        status: 200,
      }),
      env: {},
    });

    await pi.commands.get('app:start')?.('', ctx);
    await pi.commands.get('app:stop')?.('', ctx);
    const attached = JSON.parse(
      readFileSync(join(root, '.state.json'), 'utf8'),
    ) as AppState;
    expect(attached).toMatchObject({
      lifecycle: 'running',
      ownership: 'external',
      port: 5006,
    });
    expect(runtime.signals).toEqual([]);
  });

  it('starts an owned process with explicit DATA_DIR, parses health, then stops it', async () => {
    const root = project();
    roots.push(root);
    const runtime = fakeRuntime(root);
    const pi = new FakePi();
    const probe = vi.fn(async (url: string) => ({
      url,
      healthy: true,
      identified: true,
      status: 200,
    }));
    const ctx = context(root);
    createRunAppExtension(pi.api, {
      statePath: join(root, '.state.json'),
      logPath: join(root, 'dev.log'),
      currentPid: 99,
      token: () => 'token',
      processRuntime: runtime,
      probe,
      scan: async () => null,
      env: { DATA_DIR: join(root, 'explicit-data') },
      startupSleep: async () => undefined,
    });

    await pi.commands.get('app:start')?.('', ctx);
    const started = JSON.parse(
      readFileSync(join(root, '.state.json'), 'utf8'),
    ) as AppState;
    expect(started).toMatchObject({
      lifecycle: 'running',
      ownership: 'owned',
      pid: 41,
      port: 5008,
      dataDir: join(root, 'explicit-data'),
    });
    expect(probe).toHaveBeenCalledWith(
      'http://localhost:5008',
      expect.anything(),
    );

    await pi.events.get('session_shutdown')?.({ reason: 'reload' }, ctx);
    expect(runtime.signals).toEqual([]);
    const preserved = JSON.parse(
      readFileSync(join(root, '.state.json'), 'utf8'),
    ) as AppState;
    expect(preserved.lifecycle).toBe('running');

    await pi.events.get('session_shutdown')?.({ reason: 'quit' }, ctx);
    const stopped = JSON.parse(
      readFileSync(join(root, '.state.json'), 'utf8'),
    ) as AppState;
    expect(stopped).toMatchObject({
      lifecycle: 'stopped',
      ownership: 'none',
      pid: null,
    });
    expect(runtime.signals).toEqual(['SIGTERM']);
  });

  it('persists reloadable stopped diagnostics when spawning fails', async () => {
    const root = project();
    roots.push(root);
    const path = join(root, '.state.json');
    const pi = new FakePi();
    createRunAppExtension(pi.api, {
      statePath: path,
      logPath: join(root, 'dev.log'),
      currentPid: 99,
      processRuntime: {
        ...fakeRuntime(root),
        spawnDev: () => {
          throw new Error('spawn failed');
        },
      },
      scan: async () => null,
      env: {},
    });

    await pi.commands.get('app:start')?.('', context(root));

    expect(loadState(path)).toMatchObject({
      lifecycle: 'stopped',
      ownership: 'none',
      staleReason: 'spawn failed',
    });
  });

  it('joins startup and stop cancellation cleans the spawned group', async () => {
    const root = project();
    roots.push(root);
    const runtime = fakeRuntime(root);
    const pi = new FakePi();
    let sleeps = 0;
    const ctx = context(root);
    createRunAppExtension(pi.api, {
      statePath: join(root, '.state.json'),
      logPath: join(root, 'dev.log'),
      currentPid: 99,
      token: () => 'token',
      processRuntime: runtime,
      probe: async (url) => ({
        url,
        healthy: false,
        identified: false,
        status: null,
      }),
      scan: async () => null,
      env: {},
      startupTimeoutMs: 1_000,
      startupSleep: async () => {
        sleeps++;
        await new Promise((resolve) => setTimeout(resolve, 2));
      },
    });

    const first = pi.commands.get('app:start')?.('', ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const joined = pi.commands.get('app:start')?.('', ctx);
    const stop = pi.commands.get('app:stop')?.('', ctx);
    await Promise.all([first, joined, stop]);

    expect(sleeps).toBeGreaterThan(0);
    expect(runtime.signals).toEqual(['SIGTERM']);
    const stopped = JSON.parse(
      readFileSync(join(root, '.state.json'), 'utf8'),
    ) as AppState;
    expect(stopped.lifecycle).toBe('stopped');
  });
});
