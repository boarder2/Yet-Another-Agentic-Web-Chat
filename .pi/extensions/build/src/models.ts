/**
 * Model specs are the strings a user writes in `.pi/build.json`:
 * `provider/id`, `provider/id:thinking`, or a bare `id`. Every role's model is
 * resolved before a workflow starts, so a typo is a startup error rather than a
 * chunk that dies three phases in.
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export const ROLES = ['plan', 'coder', 'tester', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that run as their own agent in a herdr pane. `plan` is the main session. */
export const AGENT_ROLES = ['coder', 'tester', 'reviewer'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface ModelSpec {
  raw: string;
  provider: string | null;
  id: string;
  thinkingLevel: string | null;
}

export function parseModelSpec(raw: string): ModelSpec {
  const trimmed = raw.trim();
  // Only the last colon can introduce a thinking level; provider ids never contain one.
  const colon = trimmed.lastIndexOf(':');
  const slash = trimmed.indexOf('/');
  const hasThinking = colon > slash;

  const withoutThinking = hasThinking ? trimmed.slice(0, colon) : trimmed;
  const thinkingLevel = hasThinking ? trimmed.slice(colon + 1) : null;

  return {
    raw: trimmed,
    provider: slash === -1 ? null : withoutThinking.slice(0, slash),
    id: slash === -1 ? withoutThinking : withoutThinking.slice(slash + 1),
    thinkingLevel,
  };
}

type Registry = ExtensionContext['modelRegistry'];
type Model = NonNullable<ReturnType<Registry['find']>>;

export function resolveModel(registry: Registry, raw: string): Model | null {
  const spec = parseModelSpec(raw);
  if (spec.provider) {
    const exact = registry.find(spec.provider, spec.id);
    if (exact) return exact;
  }

  return (
    registry
      .getAvailable()
      .find(
        (model) =>
          (!spec.provider || model.provider === spec.provider) &&
          (model.id === spec.id || model.name === spec.id),
      ) ?? null
  );
}

/** The subset of specs that no model in the catalogue answers to. */
export function unresolvableModels(
  registry: Registry,
  models: Record<Role, string>,
): string[] {
  return ROLES.filter((role) => !resolveModel(registry, models[role])).map(
    (role) => `${role}: ${models[role]}`,
  );
}
