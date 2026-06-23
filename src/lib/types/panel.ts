/**
 * Agent Panel types & request contract.
 *
 * Panel mode runs the same user prompt across 2–4 "panel" (executor) models in
 * parallel (each a full agentic SimplifiedAgent restricted to non-prompting
 * research tools), then has the turn's chat model synthesize a single final
 * answer from their results.
 */

export type ModelRef = {
  provider: string;
  name: string;
  contextWindowSize?: number;
};

export type PanelExecutorConfig = ModelRef & {
  imageCapable?: boolean;
};

export type PanelConfig = {
  executors: PanelExecutorConfig[];
  /** Reserved for future panel options (timeouts, concurrency overrides). */
  options?: Record<string, never>;
};

export const PANEL_MIN_EXECUTORS = 2;
export const PANEL_MAX_EXECUTORS = 4;

function isModelRef(v: unknown): v is ModelRef {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.provider === 'string' &&
    r.provider.length > 0 &&
    typeof r.name === 'string' &&
    r.name.length > 0
  );
}

/**
 * Pure validation of a panel config: enforces 2–4 executors. The turn's chat
 * model synthesizes their results, so no orchestrator model is configured here.
 * Returns a discriminated result so both the client and the route can guard on it.
 */
export function validatePanelConfig(
  p: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof p !== 'object' || p === null) {
    return { ok: false, error: 'Panel config is missing or invalid.' };
  }
  const cfg = p as Record<string, unknown>;
  if (!Array.isArray(cfg.executors)) {
    return { ok: false, error: 'Panel config requires an executors array.' };
  }
  if (cfg.executors.length < PANEL_MIN_EXECUTORS) {
    return {
      ok: false,
      error: `Panel requires at least ${PANEL_MIN_EXECUTORS} executors.`,
    };
  }
  if (cfg.executors.length > PANEL_MAX_EXECUTORS) {
    return {
      ok: false,
      error: `Panel allows at most ${PANEL_MAX_EXECUTORS} executors.`,
    };
  }
  if (!cfg.executors.every(isModelRef)) {
    return { ok: false, error: 'Each executor must specify provider + name.' };
  }
  return { ok: true };
}
