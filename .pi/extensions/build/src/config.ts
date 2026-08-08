import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLES, type Role } from './models.ts';

export interface BuildConfig {
  /**
   * One model per role. Required and never defaulted: which model plans and which
   * one grinds chunks is a cost/quality decision the user makes, not one the
   * harness guesses at.
   */
  models: Record<Role, string>;
  /** Commands run at close. Advisory: a failure is reported, never blocking. */
  checks: string[];
  /** Coder/tester rounds per chunk before the loop stops and asks the user. */
  maxRounds: number;
  /** Reseed a long-lived agent once its context passes this share of the window. */
  contextBudget: number;
  /** How long a single agent turn may run before the round is failed. */
  turnTimeoutMs: number;
  /** How long to wait for the user to unblock an agent that asked a question. */
  blockedTimeoutMs: number;
}

export const CONFIG_PATH = '.pi/build.json';

const DEFAULTS = {
  checks: [] as string[],
  maxRounds: 2,
  contextBudget: 0.6,
  turnTimeoutMs: 1_800_000,
  blockedTimeoutMs: 900_000,
};

export type LoadedConfig =
  | { ok: true; config: BuildConfig }
  | { ok: false; problems: string[] };

export function loadConfig(cwd: string): LoadedConfig {
  const path = join(cwd, CONFIG_PATH);
  if (!existsSync(path)) {
    return {
      ok: false,
      problems: [`${CONFIG_PATH} does not exist. It must declare a model per role.`],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    return { ok: false, problems: [`${CONFIG_PATH} is not valid JSON: ${error}`] };
  }
  return parseConfig(raw);
}

/**
 * Non-model settings fall back rather than fail, so a stray `maxRounds` cannot
 * leave a workflow unrunnable. Models are the exception: a missing one is an
 * error, because silently planning on the coder's model is exactly the mistake
 * this config exists to prevent.
 */
export function parseConfig(raw: unknown): LoadedConfig {
  const input = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];

  if ('reviewerModel' in input) {
    problems.push(
      '`reviewerModel` has been replaced by the `models` map. Move it to `models.reviewer`.',
    );
  }

  const declared = (input.models ?? {}) as Record<string, unknown>;
  const models = {} as Record<Role, string>;
  for (const role of ROLES) {
    const value = declared[role];
    if (typeof value !== 'string' || !value.trim()) {
      problems.push(`models.${role} is missing.`);
      continue;
    }
    models[role] = value.trim();
  }

  const unknown = Object.keys(declared).filter(
    (key) => !ROLES.includes(key as Role),
  );
  if (unknown.length) {
    problems.push(`Unknown role(s) in models: ${unknown.join(', ')}.`);
  }

  if (problems.length) return { ok: false, problems };

  return {
    ok: true,
    config: {
      models,
      checks: Array.isArray(input.checks)
        ? input.checks.filter(
            (check): check is string =>
              typeof check === 'string' && check.trim() !== '',
          )
        : DEFAULTS.checks,
      maxRounds:
        typeof input.maxRounds === 'number' && input.maxRounds >= 1
          ? Math.floor(input.maxRounds)
          : DEFAULTS.maxRounds,
      contextBudget:
        typeof input.contextBudget === 'number' &&
        input.contextBudget > 0 &&
        input.contextBudget <= 1
          ? input.contextBudget
          : DEFAULTS.contextBudget,
      turnTimeoutMs: positiveOr(input.turnTimeoutMs, DEFAULTS.turnTimeoutMs),
      blockedTimeoutMs: positiveOr(
        input.blockedTimeoutMs,
        DEFAULTS.blockedTimeoutMs,
      ),
    },
  };
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? Math.floor(value) : fallback;
}
