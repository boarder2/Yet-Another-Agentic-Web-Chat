import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_LOG_PATH,
  HEALTH_INTERVAL_MS,
  STARTUP_TIMEOUT_MS,
} from './constants.ts';
import {
  appUrl,
  nextHealthState,
  probeYAAWC,
  scanYAAWCPorts,
  type HealthProbe,
  type PortProbe,
} from './health.ts';
import {
  createHerdrClient,
  type HerdrClient,
  type TailPaneValidation,
} from './herdr.ts';
import {
  actionableLogMessage,
  createPager,
  logExists,
  writeOwnedLogHeader,
  type Pager,
} from './logs.ts';
import {
  controllerAccess,
  validateOwnedProcess,
  type ProcessValidation,
} from './ownership.ts';
import { preflightProject } from './preflight.ts';
import {
  createProcessRuntime,
  type ProcessRuntime,
  type SpawnedProcess,
} from './process.ts';
import { loadState, saveState } from './state.ts';
import { terminateOwnedGroup } from './shutdown.ts';
import {
  StartupCancelledError,
  StartupChildExitedError,
  StartupTimeoutError,
  waitForReady,
} from './startup.ts';
import {
  staleState,
  stoppedFrom,
  stoppedState,
  type AppState,
} from './types.ts';
import {
  openPagerInTui,
  setFooterStatus,
  withCancellableLoader,
} from './ui.ts';

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = join(EXTENSION_DIR, '..', '.state.json');
type Probe = (url: string, signal?: AbortSignal) => Promise<HealthProbe>;
type Scan = (signal?: AbortSignal) => Promise<PortProbe | null>;

type Outcome = 'success' | 'cancelled' | 'failed';

export interface RunAppDeps {
  statePath?: string;
  logPath?: string;
  processRuntime?: ProcessRuntime;
  herdr?: HerdrClient;
  pager?: Pager;
  probe?: Probe;
  scan?: Scan;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  currentPid?: number;
  now?: () => Date;
  token?: () => string;
  startupSleep?: (ms: number) => Promise<void>;
  startupTimeoutMs?: number;
  healthIntervalMs?: number;
}

interface StartupOperation {
  controller: AbortController;
  promise: Promise<Outcome>;
}

interface TailCloseResult {
  paneId: string | null;
  validation?: TailPaneValidation;
}

export function createRunAppExtension(
  pi: ExtensionAPI,
  supplied: RunAppDeps = {},
): void {
  const deps = {
    statePath: supplied.statePath ?? DEFAULT_STATE_PATH,
    logPath: supplied.logPath ?? DEFAULT_LOG_PATH,
    processRuntime: supplied.processRuntime ?? createProcessRuntime(),
    herdr: supplied.herdr ?? createHerdrClient(),
    pager: supplied.pager ?? createPager(),
    probe:
      supplied.probe ??
      ((url: string, signal?: AbortSignal) => probeYAAWC(url, { signal })),
    scan:
      supplied.scan ??
      ((signal?: AbortSignal) =>
        scanYAAWCPorts({
          signal,
          probe: (url, childSignal) => probeYAAWC(url, { signal: childSignal }),
        })),
    env: supplied.env ?? process.env,
    platform: supplied.platform ?? process.platform,
    currentPid: supplied.currentPid ?? process.pid,
    now: supplied.now ?? (() => new Date()),
    token: supplied.token ?? (() => randomUUID()),
    startupSleep: supplied.startupSleep,
    startupTimeoutMs: supplied.startupTimeoutMs ?? STARTUP_TIMEOUT_MS,
    healthIntervalMs: supplied.healthIntervalMs ?? HEALTH_INTERVAL_MS,
  };

  let state: AppState | null = null;
  let currentContext: ExtensionContext | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let healthGeneration = 0;
  let lifecycleQueue: Promise<unknown> = Promise.resolve();
  let startup: StartupOperation | null = null;
  let removeChildExitListener: (() => void) | null = null;

  function enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = lifecycleQueue.then(operation, operation);
    lifecycleQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function notify(
    ctx: ExtensionContext,
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
  ): void {
    if (ctx.hasUI) ctx.ui.notify(message, level);
  }

  function unsupported(ctx: ExtensionContext, command: string): void {
    notify(ctx, `${command} requires Pi notification-capable UI.`, 'warning');
  }

  function argumentFree(
    args: string,
    command: string,
    ctx: ExtensionContext,
  ): boolean {
    if (!args.trim()) return true;
    notify(ctx, `${command} takes no arguments.`, 'warning');
    return false;
  }

  function rememberContext(ctx: ExtensionContext): void {
    currentContext = ctx;
    if (!state) state = loadStateFor(ctx.cwd);
    updateFooter(ctx);
  }

  function loadStateFor(cwd: string): AppState | null {
    const loaded = loadState(deps.statePath);
    if (!loaded || resolve(loaded.cwd) !== resolve(cwd)) return null;
    return loaded;
  }

  function persist(next: AppState): void {
    state = next;
    saveState(deps.statePath, next);
    updateFooter(currentContext);
  }

  function updateFooter(ctx: ExtensionContext | null = currentContext): void {
    if (!ctx) return;
    if (!state || !state.port || state.lifecycle === 'stopped') {
      setFooterStatus(ctx, undefined);
      return;
    }
    const word =
      state.health === 'healthy'
        ? 'healthy'
        : state.health === 'unhealthy'
          ? 'unhealthy'
          : 'starting';
    const color =
      state.health === 'healthy'
        ? 'success'
        : state.health === 'unhealthy'
          ? 'warning'
          : 'dim';
    setFooterStatus(
      ctx,
      ctx.ui.theme.fg(color, `YAAWC :${state.port} ${word}`),
    );
  }

  function clearHealthPolling(): void {
    healthGeneration++;
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
  }

  function startHealthPolling(ctx: ExtensionContext): void {
    clearHealthPolling();
    if (
      !state?.url ||
      state.lifecycle === 'stopped' ||
      state.lifecycle === 'stale'
    )
      return;
    const generation = healthGeneration;
    const url = state.url;
    const poll = async (): Promise<void> => {
      let result: HealthProbe;
      try {
        result = await deps.probe(url);
      } catch (error) {
        result = {
          url,
          healthy: false,
          identified: false,
          status: null,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (generation !== healthGeneration) return;
      await enqueue(async () => {
        if (
          generation !== healthGeneration ||
          !state ||
          state.url !== url ||
          state.lifecycle === 'stopped'
        ) {
          return;
        }
        const nextHealth = nextHealthForState(state, result);
        if (
          nextHealth.health !== state.health ||
          nextHealth.consecutiveFailures !== state.consecutiveFailures
        ) {
          persist({ ...state, ...nextHealth });
        }
        updateFooter(ctx);
      }).catch(() => {
        // A command may be replacing state; the next poll will retry.
      });
    };
    void poll();
    healthTimer = setInterval(() => void poll(), deps.healthIntervalMs);
    if (typeof healthTimer === 'object' && 'unref' in healthTimer) {
      healthTimer.unref();
    }
  }

  function nextHealthForState(
    previous: AppState,
    result: HealthProbe,
  ): Pick<AppState, 'health' | 'consecutiveFailures'> {
    return nextHealthState(
      previous.health,
      previous.consecutiveFailures,
      result,
    );
  }

  async function probeSafely(url: string): Promise<HealthProbe> {
    try {
      return await deps.probe(url);
    } catch (error) {
      return {
        url,
        healthy: false,
        identified: false,
        status: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function supportedPlatform(ctx: ExtensionContext): boolean {
    if (deps.platform !== 'win32') return true;
    notify(
      ctx,
      '/app:start is unsupported on Windows; use Linux or macOS.',
      'error',
    );
    return false;
  }

  async function knownControllerAccess(
    candidate: AppState,
  ): Promise<'current' | 'foreign-live' | 'adoptable'> {
    return controllerAccess(candidate.controllerPid, deps.currentPid, (pid) =>
      deps.processRuntime.controllerAlive(pid),
    );
  }

  async function validateStateProcess(
    candidate: AppState,
  ): Promise<ProcessValidation> {
    return validateOwnedProcess(candidate, deps.processRuntime);
  }

  async function adoptIfSafe(
    candidate: AppState,
    requireHealthy: boolean,
  ): Promise<boolean> {
    const access = await knownControllerAccess(candidate);
    if (access === 'foreign-live') return false;
    const validation = await validateStateProcess(candidate);
    if (!validation.ok) return false;
    if (requireHealthy) {
      if (!candidate.url) return false;
      const health = await probeSafely(candidate.url);
      if (!health.healthy) return false;
    }
    if (access === 'adoptable') {
      persist({ ...candidate, controllerPid: deps.currentPid });
    }
    return true;
  }

  async function attachExternal(
    found: PortProbe,
    ctx: ExtensionContext,
  ): Promise<void> {
    clearHealthPolling();
    persist({
      ...stoppedState(ctx.cwd, deps.logPath),
      lifecycle: 'running',
      ownership: 'external',
      cwd: ctx.cwd,
      port: found.port,
      url: found.url,
      health: 'healthy',
      startedAt: deps.now().toISOString(),
    });
    startHealthPolling(ctx);
  }

  async function closeTailPane(candidate: AppState): Promise<TailCloseResult> {
    const paneId = candidate.tailPaneId;
    if (!paneId) return { paneId: null };
    if (!herdrAvailable()) return { paneId };

    const validation = await deps.herdr.validateTailPane({
      paneId,
      cwd: candidate.cwd,
      logPath: candidate.logPath,
    });
    if (!validation.valid) {
      persist({ ...candidate, tailPaneId: null });
      return { paneId: null, validation };
    }

    try {
      await deps.herdr.closePane(paneId);
      persist({ ...candidate, tailPaneId: null });
      return { paneId: null, validation };
    } catch {
      return { paneId, validation };
    }
  }

  function herdrAvailable(): boolean {
    return deps.env.HERDR_ENV === '1' && deps.env.HERDR_DELEGATE !== '1';
  }

  function herdrReadyForTail(ctx: ExtensionContext): boolean {
    if (!herdrAvailable() || !deps.env.HERDR_PANE_ID) {
      notify(
        ctx,
        '/app:logs-tail requires HERDR_ENV=1, HERDR_DELEGATE!=1, and HERDR_PANE_ID in the caller pane.',
        'warning',
      );
      return false;
    }
    return true;
  }

  function attachChildExit(child: SpawnedProcess, token: string): void {
    removeChildExitListener?.();
    removeChildExitListener = child.onExit(() => {
      if (state?.ownershipToken !== token || state.pid !== child.pid) return;
      if (state.lifecycle === 'starting') return;
      void enqueue(async () => {
        if (state?.ownershipToken !== token || state.pid !== child.pid) return;
        clearHealthPolling();
        persist(
          staleState(state, 'the owned YAAWC process exited unexpectedly'),
        );
        updateFooter(currentContext);
      });
    });
  }

  function detachChild(): void {
    removeChildExitListener?.();
    removeChildExitListener = null;
  }

  function preflightFailure(ctx: ExtensionContext): string | null {
    const result = preflightProject(ctx.cwd);
    return result.ok
      ? null
      : `Cannot start YAAWC:\n- ${result.problems.join('\n- ')}`;
  }

  async function signalOwned(
    candidate: AppState,
    forceDuringStartup = false,
  ): Promise<{ ok: boolean; reason?: string }> {
    const validation = await validateStateProcess(candidate);
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const health = candidate.url ? await probeSafely(candidate.url) : null;
    if (
      !forceDuringStartup &&
      !health?.identified &&
      !validation.identityVerified
    ) {
      return {
        ok: false,
        reason: 'the recorded YAAWC health endpoint could not be verified',
      };
    }

    try {
      const result = await terminateOwnedGroup(candidate, deps.processRuntime, {
        validate: async () => validation,
      });
      return result.ok
        ? { ok: true }
        : {
            ok: false,
            reason: result.refused ?? 'the process group did not exit',
          };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function cleanOwnedStateForStart(
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (!state || state.ownership !== 'owned' || state.lifecycle === 'stopped')
      return true;
    const candidate = state;
    const access = await knownControllerAccess(candidate);
    if (access === 'foreign-live') {
      notify(
        ctx,
        `YAAWC is controlled by another live Pi process (PID ${candidate.controllerPid}). It will not be adopted or stopped here.`,
        'warning',
      );
      return false;
    }

    const validation = await validateStateProcess(candidate);
    if (validation.ok) {
      const termination = await signalOwned(
        candidate,
        candidate.lifecycle === 'starting',
      );
      if (!termination.ok) {
        notify(
          ctx,
          `Cannot clean the previous owned YAAWC process: ${termination.reason}`,
          'error',
        );
        return false;
      }
    }

    const tail = await closeTailPane(candidate);
    clearHealthPolling();
    persist({
      ...stoppedFrom(
        candidate,
        'previous owned run cleaned before a new start',
        deps.now(),
      ),
      tailPaneId: tail.paneId,
    });
    return true;
  }

  async function startCore(
    ctx: ExtensionCommandContext,
    externalSignal: AbortSignal,
  ): Promise<Outcome> {
    if (!supportedPlatform(ctx)) return 'failed';
    state ??= loadStateFor(ctx.cwd);

    if (state?.ownership === 'owned' && state.lifecycle !== 'stopped') {
      const access = await knownControllerAccess(state);
      if (access === 'foreign-live') {
        notify(
          ctx,
          `YAAWC is owned by another live Pi process (PID ${state.controllerPid}); this Pi will not adopt or stop it.`,
          'warning',
        );
        return 'failed';
      }
      if (state.lifecycle === 'running' && (await adoptIfSafe(state, true))) {
        startHealthPolling(ctx);
        notify(ctx, `YAAWC is already running at ${state.url}.`, 'info');
        return 'success';
      }
    }

    if (!(await cleanOwnedStateForStart(ctx))) return 'failed';

    const found = await deps.scan(externalSignal);
    if (externalSignal.aborted) return 'cancelled';
    if (found) {
      await attachExternal(found, ctx);
      notify(
        ctx,
        `Attached to healthy external YAAWC at ${found.url}. It is not owned and /app:stop will not stop it.`,
        'info',
      );
      return 'success';
    }

    const preflightError = preflightFailure(ctx);
    if (preflightError) {
      notify(ctx, preflightError, 'error');
      return 'failed';
    }
    if (externalSignal.aborted) return 'cancelled';
    const dataDir = deps.env.DATA_DIR || join(ctx.cwd, 'data');
    const token = deps.token();
    try {
      writeOwnedLogHeader(deps.logPath, ctx.cwd, dataDir, deps.now());
    } catch (error) {
      notify(
        ctx,
        actionableLogMessage(
          deps.logPath,
          `Could not prepare the user-only YAAWC log: ${error instanceof Error ? error.message : String(error)}`,
        ),
        'error',
      );
      return 'failed';
    }

    let child: SpawnedProcess;
    try {
      child = deps.processRuntime.spawnDev({
        cwd: ctx.cwd,
        dataDir,
        token,
        logPath: deps.logPath,
        env: deps.env,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const failed: AppState = {
        ...stoppedState(ctx.cwd, deps.logPath),
        dataDir,
        stoppedAt: deps.now().toISOString(),
        staleReason: reason,
      };
      persist(failed);
      notify(
        ctx,
        actionableLogMessage(
          deps.logPath,
          `Could not start npm run dev: ${reason}`,
        ),
        'error',
      );
      return 'failed';
    }

    const starting: AppState = {
      ...stoppedState(ctx.cwd, deps.logPath),
      lifecycle: 'starting',
      ownership: 'owned',
      pid: child.pid,
      pgid: child.pgid,
      ownershipToken: token,
      controllerPid: deps.currentPid,
      cwd: ctx.cwd,
      dataDir,
      logPath: deps.logPath,
      tailPaneId: state?.tailPaneId ?? null,
      health: 'unknown',
      startedAt: deps.now().toISOString(),
    };
    try {
      persist(starting);
      attachChildExit(child, token);
    } catch (error) {
      const cleanup = await signalOwned(starting, true);
      detachChild();
      const reason = `Could not persist YAAWC process state: ${error instanceof Error ? error.message : String(error)}`;
      try {
        persist(
          cleanup.ok
            ? stoppedFrom(starting, reason, deps.now())
            : staleState(
                starting,
                `${reason}; cleanup failed: ${cleanup.reason}`,
              ),
        );
      } catch {
        // The original state-store error is the actionable failure.
      }
      notify(ctx, actionableLogMessage(deps.logPath, reason), 'error');
      return 'failed';
    }

    try {
      const ready = await waitForReady({
        signal: externalSignal,
        timeoutMs: deps.startupTimeoutMs,
        sleep: deps.startupSleep,
        isExited: () => child.hasExited(),
        readLog: () => readFileIfPresent(deps.logPath),
        urlForPort: appUrl,
        probe: deps.probe,
      });
      if (!state || state.ownershipToken !== token) return 'failed';
      persist({
        ...state,
        lifecycle: 'running',
        port: ready.port,
        url: ready.url,
        health: 'healthy',
        consecutiveFailures: 0,
      });
      startHealthPolling(ctx);
      notify(
        ctx,
        `YAAWC started at ${ready.url} with DATA_DIR=${dataDir}.`,
        'info',
      );
      return 'success';
    } catch (error) {
      const cancelled =
        error instanceof StartupCancelledError || externalSignal.aborted;
      const reason = cancelled
        ? 'YAAWC start cancelled.'
        : error instanceof StartupTimeoutError
          ? error.message
          : error instanceof StartupChildExitedError
            ? error.message
            : `YAAWC startup failed: ${error instanceof Error ? error.message : String(error)}`;
      let termination: { ok: boolean; reason?: string };
      try {
        termination = await signalOwned(state ?? starting, true);
      } catch (cleanupError) {
        termination = {
          ok: false,
          reason:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        };
      }
      detachChild();
      clearHealthPolling();
      const finished = state ?? starting;
      persist(
        termination.ok
          ? stoppedFrom(finished, reason, deps.now())
          : staleState(
              finished,
              `${reason} Cleanup could not fully stop the owned group: ${termination.reason}`,
            ),
      );
      notify(
        ctx,
        termination.ok
          ? actionableLogMessage(deps.logPath, reason)
          : actionableLogMessage(
              deps.logPath,
              `${reason} Cleanup could not fully stop the owned group: ${termination.reason}`,
            ),
        cancelled ? 'warning' : 'error',
      );
      return cancelled ? 'cancelled' : 'failed';
    }
  }

  async function requestStart(ctx: ExtensionCommandContext): Promise<void> {
    rememberContext(ctx);
    if (!ctx.hasUI) {
      unsupported(ctx, '/app:start');
      return;
    }
    if (startup) {
      notify(ctx, 'YAAWC start is already in progress; joining it.', 'info');
      await startup.promise;
      return;
    }

    const controller = new AbortController();
    const promise = enqueue(async () => {
      const result = await withCancellableLoader(
        ctx,
        'Starting YAAWC…',
        controller.signal,
        (signal) => startCore(ctx, signal),
      );
      if (result.error) {
        notify(
          ctx,
          `YAAWC start failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
          'error',
        );
        return 'failed' as Outcome;
      }
      return result.cancelled
        ? ('cancelled' as Outcome)
        : (result.value ?? 'failed');
    });
    startup = { controller, promise };
    void promise.then(
      () => {
        if (startup?.promise === promise) startup = null;
      },
      () => {
        if (startup?.promise === promise) startup = null;
      },
    );
    await promise;
  }

  async function stopCore(
    ctx: ExtensionCommandContext,
    quiet = false,
  ): Promise<void> {
    state ??= loadStateFor(ctx.cwd);
    if (!state || state.lifecycle === 'stopped' || state.ownership === 'none') {
      if (!quiet) notify(ctx, 'No owned YAAWC process is running.', 'info');
      return;
    }
    if (state.ownership === 'external') {
      if (!quiet) {
        notify(
          ctx,
          `YAAWC at ${state.url ?? '(unknown URL)'} is external; /app:stop will not stop it.`,
          'warning',
        );
      }
      return;
    }

    const candidate = state;
    const access = await knownControllerAccess(candidate);
    if (access === 'foreign-live') {
      if (!quiet) {
        notify(
          ctx,
          `YAAWC is controlled by another live Pi process (PID ${candidate.controllerPid}); it was not stopped.`,
          'warning',
        );
      }
      return;
    }
    if (access === 'adoptable')
      persist({ ...candidate, controllerPid: deps.currentPid });

    const validation = await validateStateProcess(state);
    if (validation.ok) {
      const termination = await signalOwned(
        state,
        state.lifecycle === 'starting',
      );
      if (!termination.ok) {
        if (!quiet)
          notify(ctx, `YAAWC was not stopped: ${termination.reason}`, 'error');
        return;
      }
    }

    clearHealthPolling();
    const tail = await closeTailPane(state);
    detachChild();
    const finished = stoppedFrom(
      state,
      validation.ok ? undefined : validation.reason,
      deps.now(),
    );
    persist({ ...finished, tailPaneId: tail.paneId });
    if (!quiet) {
      notify(
        ctx,
        validation.ok
          ? `Owned YAAWC stopped. Logs were preserved at ${state.logPath}.`
          : `Owned YAAWC process was already gone or stale (${validation.reason ?? 'unknown identity'}). Logs were preserved.`,
        validation.ok ? 'info' : 'warning',
      );
    }
  }

  async function requestStop(
    ctx: ExtensionCommandContext,
    quiet = false,
  ): Promise<void> {
    rememberContext(ctx);
    if (!ctx.hasUI && !quiet) {
      unsupported(ctx, '/app:stop');
      return;
    }
    const pending = startup;
    if (pending) pending.controller.abort();
    await enqueue(async () => {
      if (pending) await pending.promise.catch(() => undefined);
      await stopCore(ctx, quiet);
    });
  }

  async function statusCore(ctx: ExtensionCommandContext): Promise<void> {
    state ??= loadStateFor(ctx.cwd);
    if (state?.ownership === 'owned' && state.lifecycle !== 'stopped') {
      const access = await knownControllerAccess(state);
      const validation = await validateStateProcess(state);
      if (!validation.ok && state.lifecycle !== 'stale') {
        persist(
          staleState(
            state,
            validation.reason ?? 'owned process identity is stale',
          ),
        );
      } else if (
        access === 'adoptable' &&
        validation.ok &&
        state.lifecycle === 'running'
      ) {
        persist({ ...state, controllerPid: deps.currentPid });
      }
    }

    if (!state || state.lifecycle === 'stopped' || state.ownership === 'none') {
      const found = await deps.scan();
      if (found) {
        await attachExternal(found, ctx);
      }
    } else if (state.url && state.lifecycle !== 'stale') {
      const result = await probeSafely(state.url);
      if (state.ownership === 'external' && !result.identified) {
        const found = await deps.scan();
        if (found) await attachExternal(found, ctx);
        else persist({ ...state, ...nextHealthForState(state, result) });
      } else {
        persist({ ...state, ...nextHealthForState(state, result) });
      }
    }

    const tail = await tailStatus(state);
    const lines = [
      `Lifecycle: ${state?.lifecycle ?? 'stopped'}`,
      `Ownership: ${ownershipText(state)}`,
      `Controller Pi PID: ${state?.controllerPid ?? 'none'}`,
      `PID: ${state?.pid ?? 'none'}`,
      `URL: ${state?.url ?? 'none'}${state?.port ? ` (port ${state.port})` : ''}`,
      `Health: ${state?.health ?? 'unknown'}`,
      `Reason: ${state?.staleReason ?? 'none'}`,
      `DATA_DIR: ${state?.dataDir ?? (state?.ownership === 'external' ? 'unknown (external)' : 'none')}`,
      `Log: ${state?.logPath ?? deps.logPath}`,
      `Tail pane: ${tail}`,
    ];
    notify(
      ctx,
      lines.join('\n') + '\nUse /app:logs for the complete log.',
      'info',
    );
    updateFooter(ctx);
  }

  async function tailStatus(candidate: AppState | null): Promise<string> {
    if (!candidate?.tailPaneId) return 'none';
    if (!herdrAvailable())
      return `${candidate.tailPaneId} (recorded; not verified)`;
    const validation = await deps.herdr.validateTailPane({
      paneId: candidate.tailPaneId,
      cwd: candidate.cwd,
      logPath: candidate.logPath,
    });
    if (validation.valid) return `${candidate.tailPaneId} (validated)`;
    persist({ ...candidate, tailPaneId: null });
    return `none (stale pane id discarded: ${validation.reason})`;
  }

  async function logsTailCore(ctx: ExtensionCommandContext): Promise<void> {
    if (!herdrReadyForTail(ctx)) return;
    const callerPane = deps.env.HERDR_PANE_ID;
    if (!callerPane) return;
    state ??= loadStateFor(ctx.cwd);
    if (
      !state ||
      state.ownership !== 'owned' ||
      (state.lifecycle !== 'running' && state.lifecycle !== 'starting')
    ) {
      notify(
        ctx,
        'No owned YAAWC process/log is available. External processes are refused; use /app:logs.',
        'warning',
      );
      return;
    }
    if (!logExists(state.logPath)) {
      notify(
        ctx,
        `Owned YAAWC log is absent at ${state.logPath}. Use /app:logs after a run.`,
        'error',
      );
      return;
    }
    const access = await knownControllerAccess(state);
    if (access === 'foreign-live') {
      notify(
        ctx,
        `The owned YAAWC process is controlled by live Pi PID ${state.controllerPid}; logs-tail will not adopt it.`,
        'warning',
      );
      return;
    }
    if (!(await adoptIfSafe(state, true))) {
      notify(
        ctx,
        'The owned YAAWC process could not be validated as healthy; logs-tail refused.',
        'warning',
      );
      return;
    }

    if (state.tailPaneId) {
      const validation = await deps.herdr.validateTailPane({
        paneId: state.tailPaneId,
        cwd: state.cwd,
        logPath: state.logPath,
      });
      if (validation.valid) {
        try {
          await deps.herdr.focusPane(state.tailPaneId, callerPane);
          notify(
            ctx,
            `Focused existing ${state.tailPaneId} YAAWC logs pane.`,
            'info',
          );
        } catch (error) {
          notify(
            ctx,
            `Could not focus the validated YAAWC logs pane: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          );
        }
        return;
      }
      persist({ ...state, tailPaneId: null });
    }

    try {
      const paneId = await deps.herdr.splitTailPane(callerPane, ctx.cwd);
      await deps.herdr.renamePane(paneId, 'YAAWC logs');
      await deps.herdr.runTail(paneId, state.logPath);
      persist({ ...state, tailPaneId: paneId });
      notify(ctx, `YAAWC logs tail opened in pane ${paneId}.`, 'info');
    } catch (error) {
      notify(
        ctx,
        `Could not start the YAAWC logs pane: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
  }

  async function logsCore(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== 'tui') {
      notify(ctx, '/app:logs requires the Pi TUI.', 'warning');
      return;
    }
    const path = state?.logPath ?? deps.logPath;
    if (!existsSync(path)) {
      notify(
        ctx,
        `No YAAWC log exists at ${path}. Start the app first.`,
        'error',
      );
      return;
    }
    const warning = logWarning(state);
    if (warning) notify(ctx, warning, 'warning');
    const result = await openPagerInTui(ctx, path, deps.pager);
    if (result?.error)
      notify(ctx, `Could not open less: ${result.error.message}`, 'error');
    else if (result && result.status !== 0)
      notify(ctx, `less exited with status ${result.status}.`, 'warning');
  }

  function logWarning(candidate: AppState | null): string | null {
    if (!candidate)
      return 'Showing stale extension output; no current YAAWC state is recorded.';
    if (candidate.ownership === 'external') {
      return 'This is stale extension output, not logs from the external YAAWC process.';
    }
    if (candidate.lifecycle === 'stopped' || candidate.lifecycle === 'stale') {
      return 'Showing the latest stopped/stale YAAWC run; the log was preserved for diagnosis.';
    }
    return null;
  }

  pi.on('session_start', async (_event, ctx) => {
    currentContext = ctx;
    clearHealthPolling();
    detachChild();
    state = loadStateFor(ctx.cwd);
    if (!state || state.ownership !== 'owned') {
      state = null;
      updateFooter(ctx);
      return;
    }

    if (state.lifecycle !== 'stopped') {
      const access = await knownControllerAccess(state);
      const validation = await validateStateProcess(state);
      if (!validation.ok) {
        persist(
          staleState(
            state,
            validation.reason ?? 'owned process identity is stale',
          ),
        );
      } else if (
        access === 'adoptable' &&
        state.lifecycle === 'running' &&
        state.url &&
        (await probeSafely(state.url)).healthy
      ) {
        persist({ ...state, controllerPid: deps.currentPid });
      }
    }

    if (
      state.url &&
      state.lifecycle !== 'stopped' &&
      state.lifecycle !== 'stale'
    ) {
      startHealthPolling(ctx);
    }
    updateFooter(ctx);
  });

  pi.on('session_shutdown', async (event, ctx) => {
    clearHealthPolling();
    detachChild();
    setFooterStatus(ctx, undefined);
    if (event.reason === 'quit' && state?.ownership === 'owned') {
      const access = await knownControllerAccess(state);
      if (access === 'current')
        await requestStop(ctx as ExtensionCommandContext, true);
    }
    currentContext = null;
  });

  pi.registerCommand('app:start', {
    description: 'Explicitly start or attach to the YAAWC development server',
    handler: async (args, ctx) => {
      if (!argumentFree(args, '/app:start', ctx)) return;
      await requestStart(ctx);
    },
  });

  pi.registerCommand('app:stop', {
    description: 'Stop only an extension-owned YAAWC development server',
    handler: async (args, ctx) => {
      if (!argumentFree(args, '/app:stop', ctx)) return;
      await requestStop(ctx);
    },
  });

  pi.registerCommand('app:status', {
    description: 'Show YAAWC lifecycle, ownership, health, and log metadata',
    handler: async (args, ctx) => {
      if (!argumentFree(args, '/app:status', ctx)) return;
      rememberContext(ctx);
      if (!ctx.hasUI) {
        unsupported(ctx, '/app:status');
        return;
      }
      await enqueue(() => statusCore(ctx));
    },
  });

  pi.registerCommand('app:logs', {
    description: 'Open the complete latest YAAWC log in less',
    handler: async (args, ctx) => {
      if (!argumentFree(args, '/app:logs', ctx)) return;
      rememberContext(ctx);
      await enqueue(() => logsCore(ctx));
    },
  });

  pi.registerCommand('app:logs-tail', {
    description: 'Open or focus the owned YAAWC log tail in a Herdr pane',
    handler: async (args, ctx) => {
      if (!argumentFree(args, '/app:logs-tail', ctx)) return;
      rememberContext(ctx);
      await enqueue(() => logsTailCore(ctx));
    },
  });
}

function readFileIfPresent(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function ownershipText(candidate: AppState | null): string {
  if (!candidate) return 'none';
  if (candidate.ownership === 'owned') {
    return candidate.controllerPid
      ? `extension-owned (controller Pi PID ${candidate.controllerPid})`
      : 'extension-owned';
  }
  if (candidate.ownership === 'external') return 'external (never stopped)';
  return 'none';
}

export default function runAppExtension(pi: ExtensionAPI): void {
  createRunAppExtension(pi);
}
