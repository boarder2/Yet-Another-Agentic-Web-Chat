import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { DEFAULT_LOG_PATH, TAIL_PANE_TITLE } from './constants.ts';

export interface HerdrRunner {
  run(args: readonly string[]): Promise<unknown>;
}

export interface TailPaneOptions {
  paneId: string;
  cwd: string;
  logPath?: string;
}

export interface TailPaneValidation {
  valid: boolean;
  reason: string;
}

export interface HerdrClient {
  splitTailPane(callerPane: string, cwd: string): Promise<string>;
  renamePane(paneId: string, title: string): Promise<void>;
  runTail(paneId: string, logPath?: string): Promise<void>;
  focusPane(paneId: string, fromPane: string): Promise<void>;
  closePane(paneId: string): Promise<void>;
  validateTailPane(options: TailPaneOptions): Promise<TailPaneValidation>;
}

export function tailCommand(logPath = DEFAULT_LOG_PATH): string {
  return `tail -n 200 -F -- ${quotePath(logPath)}`;
}

export function createHerdrClient(
  runner: HerdrRunner = createRunner(),
): HerdrClient {
  return {
    async splitTailPane(callerPane, cwd) {
      const callerInfo = await runner.run(['pane', 'get', callerPane]);
      if (!findPane(callerInfo, callerPane)) {
        throw new Error('caller Herdr pane could not be validated');
      }
      const response = await runner.run([
        'pane',
        'split',
        '--pane',
        callerPane,
        '--direction',
        'right',
        '--ratio',
        '0.4',
        '--cwd',
        cwd,
        '--no-focus',
      ]);
      const paneId = findPaneId(response);
      if (!paneId) throw new Error('herdr pane split returned no pane id.');
      return paneId;
    },

    async renamePane(paneId, title) {
      await runner.run(['pane', 'rename', paneId, title]);
    },

    async runTail(paneId, logPath = DEFAULT_LOG_PATH) {
      await runner.run(['pane', 'run', paneId, tailCommand(logPath)]);
    },

    async focusPane(paneId, fromPane) {
      for (const direction of ['right', 'left', 'up', 'down'] as const) {
        const response = await runner.run([
          'pane',
          'neighbor',
          '--pane',
          fromPane,
          '--direction',
          direction,
        ]);
        if (findPaneId(response) !== paneId) continue;
        await runner.run([
          'pane',
          'focus',
          '--direction',
          direction,
          '--pane',
          fromPane,
        ]);
        return;
      }
      throw new Error('validated logs pane is not adjacent to the caller pane');
    },

    async closePane(paneId) {
      await runner.run(['pane', 'close', paneId]);
    },

    async validateTailPane({ paneId, cwd, logPath = DEFAULT_LOG_PATH }) {
      let paneInfo: unknown;
      let processInfo: unknown;
      try {
        paneInfo = await runner.run(['pane', 'get', paneId]);
        processInfo = await runner.run([
          'pane',
          'process-info',
          '--pane',
          paneId,
        ]);
      } catch (error) {
        return {
          valid: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      const pane = findPane(paneInfo, paneId);
      if (!pane) return { valid: false, reason: 'pane no longer exists' };

      const title = fieldString(pane, [
        'label',
        'title',
        'name',
        'pane_title',
        'paneTitle',
      ]);
      if (title !== TAIL_PANE_TITLE) {
        return { valid: false, reason: 'pane title is not YAAWC logs' };
      }

      const expectedCommand = tailCommand(logPath);
      if (!containsTailCommand(processInfo, expectedCommand)) {
        return { valid: false, reason: 'pane tail command was not proven' };
      }

      const paneCwd = fieldString(pane, [
        'foreground_cwd',
        'foregroundCwd',
        'cwd',
        'working_directory',
        'workingDirectory',
      ]);
      if (!paneCwd || resolve(paneCwd) !== resolve(cwd)) {
        return { valid: false, reason: 'pane cwd was not proven' };
      }

      return {
        valid: true,
        reason: 'extension-created YAAWC logs pane validated',
      };
    },
  };
}

function createRunner(): HerdrRunner {
  return {
    run(args) {
      return new Promise((resolve, reject) => {
        const child = spawn('herdr', [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGTERM'), 10_000);
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(
              new Error(
                `herdr ${args.join(' ')} failed: ${(stderr || stdout).trim()}`,
              ),
            );
            return;
          }
          try {
            resolve(stdout.trim() ? (JSON.parse(stdout) as unknown) : {});
          } catch {
            resolve({});
          }
        });
      });
    },
  };
}

function findPaneId(value: unknown): string | null {
  const pane = findFirstObject(value, (candidate) => {
    const id = candidate.pane_id ?? candidate.paneId;
    return typeof id === 'string';
  });
  if (!pane) return null;
  const id = pane.pane_id ?? pane.paneId;
  return typeof id === 'string' ? id : null;
}

function findPane(
  value: unknown,
  paneId: string,
): Record<string, unknown> | null {
  return findFirstObject(value, (candidate) => {
    const id = candidate.pane_id ?? candidate.paneId;
    return id === paneId;
  });
}

function findFirstObject(
  value: unknown,
  predicate: (candidate: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstObject(item, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (predicate(candidate)) return candidate;
  for (const item of Object.values(candidate)) {
    const found = findFirstObject(item, predicate);
    if (found) return found;
  }
  return null;
}

function fieldString(
  value: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const candidate = value[field];
    if (typeof candidate === 'string') return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = fieldString(candidate as Record<string, unknown>, [
        'command',
        'name',
        'value',
      ]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function containsTailCommand(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return commandMatches(value, expected);
  if (Array.isArray(value)) {
    const strings = value.filter(
      (item): item is string => typeof item === 'string',
    );
    if (
      strings.length === value.length &&
      commandMatches(strings.join(' '), expected)
    ) {
      return true;
    }
    return value.some((item) => containsTailCommand(item, expected));
  }
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const command = record.cmdline ?? record.command ?? record.foreground_process;
  if (typeof command === 'string' && commandMatches(command, expected))
    return true;
  if (Array.isArray(command) && commandMatches(command.join(' '), expected))
    return true;
  return Object.values(record).some((item) =>
    containsTailCommand(item, expected),
  );
}

function commandMatches(command: string, expected: string): boolean {
  const normalized = command
    .replaceAll(/\s+/g, ' ')
    .replace(/(^|\s)\/[^\s/]+\/tail(?=\s|$)/, '$1tail');
  return normalized.includes(expected);
}

function quotePath(path: string): string {
  return /^\/tmp\/[A-Za-z0-9._/-]+$/.test(path)
    ? path
    : `'${path.replaceAll("'", "'\\''")}'`;
}
