import { writeLocalStorageBatch } from '@/lib/hooks/useLocalStorage';

export const PRESETS_KEY = 'modelPresets';

export const SELECTION_KEYS = {
  chatProvider: 'chatModelProvider',
  chatModel: 'chatModel',
  systemProvider: 'systemModelProvider',
  systemModel: 'systemModel',
  imageCapable: 'imageCapable',
  contextWindowSize: 'contextWindowSize',
} as const;

export interface ModelPreset {
  id: string;
  name: string;
  chatProvider: string;
  chatModel: string;
  systemProvider: string;
  systemModel: string;
  imageCapable: boolean;
  contextWindowSize: number;
  createdAt: number;
}

export type ModelPresetList = ModelPreset[];

export interface ActiveSelection {
  chatProvider: string;
  chatModel: string;
  systemProvider: string;
  systemModel: string;
  imageCapable: boolean;
  contextWindowSize: number;
}

export const PRESET_MAX = 50;
export const PRESET_NAME_MAX = 60;

/**
 * Predefined context-window sizes offered in the model selectors. Shared by the
 * settings page (custom-value detection), ModelSettingsSection and
 * ModelPresetsSection (dropdown options) so all three stay consistent.
 */
export const PREDEFINED_CONTEXT_SIZES: readonly number[] = [
  1024, 2048, 3072, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 1048576,
];

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isValidPreset(p: unknown): p is ModelPreset {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.chatProvider === 'string' &&
    typeof r.chatModel === 'string' &&
    typeof r.systemProvider === 'string' &&
    typeof r.systemModel === 'string' &&
    typeof r.imageCapable === 'boolean' &&
    typeof r.contextWindowSize === 'number' &&
    !isNaN(r.contextWindowSize) &&
    typeof r.createdAt === 'number' &&
    !isNaN(r.createdAt)
  );
}

export function loadPresets(): ModelPresetList {
  try {
    const raw = readRaw(PRESETS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPreset);
  } catch {
    return [];
  }
}

export function savePresets(list: ModelPresetList): void {
  writeLocalStorageBatch([[PRESETS_KEY, JSON.stringify(list)]]);
}

export function createPreset(
  p: Omit<ModelPreset, 'id' | 'createdAt'>,
): ModelPreset {
  return {
    ...p,
    id: generateId(),
    createdAt: Date.now(),
    contextWindowSize: Math.max(512, p.contextWindowSize),
  };
}

/**
 * Cross-checks a preset's chat/system provider+model against the live model
 * catalog. `custom_openai` is skipped (its model is configured separately and
 * is not enumerable). Returns true when the catalog is not yet loaded so we
 * don't flash a spurious "unavailable" badge during load.
 */
export function isPresetAvailable(
  preset: ModelPreset,
  modelsData:
    | Record<string, Record<string, { displayName: string }>>
    | undefined,
): boolean {
  if (!modelsData) return true;
  if (preset.chatProvider !== 'custom_openai') {
    const chatProviderModels = modelsData[preset.chatProvider];
    if (!chatProviderModels || !chatProviderModels[preset.chatModel])
      return false;
  }
  if (preset.systemProvider !== 'custom_openai') {
    const sysProviderModels = modelsData[preset.systemProvider];
    if (!sysProviderModels || !sysProviderModels[preset.systemModel])
      return false;
  }
  return true;
}

/** Compact one-line summary of a preset for list rows. */
export function presetSummary(p: ModelPreset): string {
  const ctx =
    p.contextWindowSize >= 1024
      ? `${Math.round(p.contextWindowSize / 1024)}k ctx`
      : `${p.contextWindowSize} ctx`;
  const sameModel =
    p.chatModel === p.systemModel && p.chatProvider === p.systemProvider;
  if (sameModel) {
    return `${p.chatModel} · ${ctx}`;
  }
  return `${p.chatModel} · sys: ${p.systemModel} · ${ctx}`;
}

export function findMatchingPreset(
  list: ModelPresetList,
  sel: ActiveSelection,
): ModelPreset | null {
  return (
    list.find(
      (p) =>
        p.chatProvider === sel.chatProvider &&
        p.chatModel === sel.chatModel &&
        p.systemProvider === sel.systemProvider &&
        p.systemModel === sel.systemModel &&
        p.imageCapable === sel.imageCapable &&
        p.contextWindowSize === sel.contextWindowSize,
    ) ?? null
  );
}

export function captureCurrentSelection(): ActiveSelection {
  const cwRaw = parseInt(
    readRaw(SELECTION_KEYS.contextWindowSize) ?? String(DEFAULT_CONTEXT_WINDOW),
    10,
  );
  return {
    chatProvider: readRaw(SELECTION_KEYS.chatProvider) ?? '',
    chatModel: readRaw(SELECTION_KEYS.chatModel) ?? '',
    systemProvider: readRaw(SELECTION_KEYS.systemProvider) ?? '',
    systemModel: readRaw(SELECTION_KEYS.systemModel) ?? '',
    imageCapable: readRaw(SELECTION_KEYS.imageCapable) === 'true',
    contextWindowSize: isNaN(cwRaw) ? DEFAULT_CONTEXT_WINDOW : cwRaw,
  };
}

/**
 * Controlled value shared by the unified `ModelPicker` component and every
 * caller that drives it (chat, settings, presets, scheduled tasks, widgets).
 * `imageCapable` and `contextWindowSize` are optional because some surfaces
 * (single-model pickers) don't expose them. The component is fully controlled
 * and owns no persistence — each caller persists `onChange` however it likes.
 */
export interface ModelSelection {
  chatProvider: string;
  chatModel: string;
  systemProvider: string;
  systemModel: string;
  imageCapable?: boolean;
  contextWindowSize?: number;
}

export const DEFAULT_CONTEXT_WINDOW = 32768;

/** Pure conversion of a stored preset to a `ModelSelection`. */
export function presetToSelection(p: ModelPreset): ModelSelection {
  return {
    chatProvider: p.chatProvider,
    chatModel: p.chatModel,
    systemProvider: p.systemProvider,
    systemModel: p.systemModel,
    imageCapable: p.imageCapable,
    contextWindowSize: Math.max(512, p.contextWindowSize),
  };
}

/**
 * Pure conversion of a `ModelSelection` to the input shape `createPreset`
 * expects — used by "save current as preset" from any caller. Missing optional
 * fields fall back to sensible defaults so the saved preset is always complete.
 */
export function selectionToPresetInput(
  sel: ModelSelection,
  name: string,
): Omit<ModelPreset, 'id' | 'createdAt'> {
  return {
    name,
    chatProvider: sel.chatProvider,
    chatModel: sel.chatModel,
    systemProvider: sel.systemProvider,
    systemModel: sel.systemModel,
    imageCapable: sel.imageCapable ?? false,
    contextWindowSize: sel.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW,
  };
}

/** Normalize a `ModelSelection` to an `ActiveSelection` for preset matching. */
export function selectionToActiveSelection(
  sel: ModelSelection,
): ActiveSelection {
  return {
    chatProvider: sel.chatProvider,
    chatModel: sel.chatModel,
    systemProvider: sel.systemProvider,
    systemModel: sel.systemModel,
    imageCapable: sel.imageCapable ?? false,
    contextWindowSize: sel.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW,
  };
}

/**
 * Writes a full `ModelSelection` to the chat-selection localStorage keys via a
 * single batch write so all reactive subscribers update in one render cycle,
 * preventing torn intermediate state where provider/model keys are written
 * separately.
 */
export function writeSelectionToStorage(sel: ModelSelection): void {
  writeLocalStorageBatch([
    [SELECTION_KEYS.systemProvider, sel.systemProvider],
    [SELECTION_KEYS.systemModel, sel.systemModel],
    [SELECTION_KEYS.chatProvider, sel.chatProvider],
    [SELECTION_KEYS.chatModel, sel.chatModel],
    [SELECTION_KEYS.imageCapable, sel.imageCapable ? 'true' : 'false'],
    [
      SELECTION_KEYS.contextWindowSize,
      String(Math.max(512, sel.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW)),
    ],
  ]);
}

/**
 * Applies a preset to localStorage (chat-only wrapper over the pure
 * `presetToSelection` + `writeSelectionToStorage`). Kept for callers that want
 * the one-shot "apply preset to the chat selection" behavior.
 */
export function applyPresetToStorage(p: ModelPreset): void {
  writeSelectionToStorage(presetToSelection(p));
}
