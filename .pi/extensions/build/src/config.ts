import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BuildConfig {
  /** Pinned so the reviewer is not the coder's own model reviewing its own idioms. */
  reviewerModel: string;
  /** Commands run at close. Advisory: a failure is reported, never blocking. */
  checks: string[];
  /** Coder/tester rounds per chunk before the loop stops and asks the user. */
  maxRounds: number;
  /** Reseed a long-lived agent once its context passes this share of the window. */
  contextBudget: number;
}

export const DEFAULT_CONFIG: BuildConfig = {
  reviewerModel: '~anthropic/claude-sonnet-latest',
  checks: [],
  maxRounds: 2,
  contextBudget: 0.6,
};

const CONFIG_PATH = '.pi/build.json';

export function loadConfig(cwd: string): BuildConfig {
  const path = join(cwd, CONFIG_PATH);
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    return mergeConfig(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Unknown keys are ignored and wrong types fall back, so a hand-edited config
// can never leave the workflow in an unrunnable state.
export function mergeConfig(raw: unknown): BuildConfig {
  const input = (raw ?? {}) as Partial<Record<keyof BuildConfig, unknown>>;
  const config = { ...DEFAULT_CONFIG };

  if (typeof input.reviewerModel === 'string' && input.reviewerModel.trim()) {
    config.reviewerModel = input.reviewerModel.trim();
  }
  if (Array.isArray(input.checks)) {
    config.checks = input.checks.filter(
      (check): check is string =>
        typeof check === 'string' && check.trim() !== '',
    );
  }
  if (typeof input.maxRounds === 'number' && input.maxRounds >= 1) {
    config.maxRounds = Math.floor(input.maxRounds);
  }
  if (
    typeof input.contextBudget === 'number' &&
    input.contextBudget > 0 &&
    input.contextBudget <= 1
  ) {
    config.contextBudget = input.contextBudget;
  }

  return config;
}
