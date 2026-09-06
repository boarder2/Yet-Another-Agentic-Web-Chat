/**
 * A hidden model entry is either a legacy global model id or an exact
 * provider-scoped reference. Keep this module isomorphic so server filtering
 * and the settings UI apply the same matching rules.
 */
export type ScopedHiddenModel = {
  provider: string;
  model: string;
};

export type HiddenModel = string | ScopedHiddenModel;
export type HiddenModelEntry = HiddenModel;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isScopedHiddenModel(
  value: unknown,
): value is ScopedHiddenModel {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    nonEmptyString(entry.provider) &&
    nonEmptyString(entry.model) &&
    Object.keys(entry).every((key) => key === 'provider' || key === 'model')
  );
}

/** Parse one persisted entry without accepting malformed or empty values. */
export function parseHiddenModel(value: unknown): HiddenModel | null {
  if (nonEmptyString(value)) return value;
  if (isScopedHiddenModel(value)) {
    return { provider: value.provider, model: value.model };
  }
  return null;
}

/** Parse a persisted JSON value, retaining legacy strings without migration. */
export function parseHiddenModels(value: unknown): HiddenModel[] {
  if (typeof value === 'string') {
    try {
      return parseHiddenModels(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map(parseHiddenModel)
    .filter((entry): entry is HiddenModel => entry !== null);
}

/** Whether a model is hidden by a legacy global or exact scoped entry. */
export function isHiddenModel(
  hiddenModels: readonly HiddenModel[],
  provider: string,
  model: string,
): boolean {
  return hiddenModels.some((entry) =>
    typeof entry === 'string'
      ? entry === model
      : entry.provider === provider && entry.model === model,
  );
}

export const matchesHiddenModel = isHiddenModel;
export const hiddenModelMatches = isHiddenModel;

/** Add an exact provider-scoped hide, preserving legacy entries as-is. */
export function addHiddenModel(
  hiddenModels: readonly HiddenModel[],
  provider: string,
  model: string,
): HiddenModel[] {
  if (
    !nonEmptyString(provider) ||
    !nonEmptyString(model) ||
    isHiddenModel(hiddenModels, provider, model)
  ) {
    return [...hiddenModels];
  }
  return [...hiddenModels, { provider, model }];
}

/** Remove one exact provider-scoped hide. Legacy global hides are untouched. */
export function removeHiddenModel(
  hiddenModels: readonly HiddenModel[],
  provider: string,
  model: string,
): HiddenModel[] {
  return hiddenModels.filter(
    (entry) =>
      !(
        typeof entry !== 'string' &&
        entry.provider === provider &&
        entry.model === model
      ),
  );
}

/**
 * Explicitly showing a model also consumes a matching legacy global hide.
 * Without this, the provider-scoped visibility control cannot override an old
 * string entry and would appear to do nothing.
 */
export function showHiddenModel(
  hiddenModels: readonly HiddenModel[],
  provider: string,
  model: string,
): HiddenModel[] {
  return hiddenModels.filter(
    (entry) =>
      entry !== model &&
      !(
        typeof entry !== 'string' &&
        entry.provider === provider &&
        entry.model === model
      ),
  );
}

export function addHiddenModels(
  hiddenModels: readonly HiddenModel[],
  models: readonly ScopedHiddenModel[],
): HiddenModel[] {
  return models.reduce(
    (entries, model) => addHiddenModel(entries, model.provider, model.model),
    [...hiddenModels],
  );
}

export function removeHiddenModels(
  hiddenModels: readonly HiddenModel[],
  models: readonly ScopedHiddenModel[],
): HiddenModel[] {
  const removals = new Set(
    models.map((model) => `${model.provider}\u0000${model.model}`),
  );
  return hiddenModels.filter(
    (entry) =>
      typeof entry === 'string' ||
      !removals.has(`${entry.provider}\u0000${entry.model}`),
  );
}

/** Show a set of provider/model entries, including legacy global strings. */
export function showHiddenModels(
  hiddenModels: readonly HiddenModel[],
  models: readonly ScopedHiddenModel[],
): HiddenModel[] {
  const globalRemovals = new Set(models.map((model) => model.model));
  const scopedRemovals = new Set(
    models.map((model) => `${model.provider}\u0000${model.model}`),
  );
  return hiddenModels.filter((entry) =>
    typeof entry === 'string'
      ? !globalRemovals.has(entry)
      : !scopedRemovals.has(`${entry.provider}\u0000${entry.model}`),
  );
}

export const addScopedHiddenModel = addHiddenModel;
export const removeScopedHiddenModel = removeHiddenModel;
export const addScopedHiddenModels = addHiddenModels;
export const removeScopedHiddenModels = removeHiddenModels;

export function serializeHiddenModels(
  hiddenModels: readonly HiddenModel[],
): string {
  return JSON.stringify(hiddenModels);
}
