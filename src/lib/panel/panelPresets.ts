/**
 * Saveable agent-panel configurations, stored exactly like model presets: a
 * single localStorage key synced to the DB via MIGRATED_SETTING_KEYS (no schema
 * change). A preset captures the executor models of a panel.
 */

import {
  writeLocalStorageBatch,
  readLocalStorage,
} from '@/lib/hooks/useLocalStorage';
import { generateId } from '@/lib/utils/id';
import type { PanelModelEntry } from '@/lib/panel/panelSelection';
import { PANEL_MIN, PANEL_MAX, sameModel } from '@/lib/panel/panelSelection';

export const PANEL_PRESETS_KEY = 'panelPresets';

export interface PanelPreset {
  id: string;
  name: string;
  executors: PanelModelEntry[];
  createdAt: number;
}

export type PanelPresetList = PanelPreset[];

export const PANEL_PRESET_MAX = 50;
export const PANEL_PRESET_NAME_MAX = 60;

function isModelEntry(v: unknown): v is PanelModelEntry {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.provider === 'string' && typeof r.name === 'string';
}

export function isValidPanelPreset(p: unknown): p is PanelPreset {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    Array.isArray(r.executors) &&
    r.executors.length >= PANEL_MIN &&
    r.executors.length <= PANEL_MAX &&
    r.executors.every(isModelEntry) &&
    typeof r.createdAt === 'number' &&
    !isNaN(r.createdAt)
  );
}

export function loadPanelPresets(): PanelPresetList {
  try {
    const raw = readLocalStorage(PANEL_PRESETS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPanelPreset);
  } catch {
    return [];
  }
}

export function savePanelPresets(list: PanelPresetList): void {
  writeLocalStorageBatch([[PANEL_PRESETS_KEY, JSON.stringify(list)]]);
}

export function createPanelPreset(
  p: Omit<PanelPreset, 'id' | 'createdAt'>,
): PanelPreset {
  return { ...p, id: generateId(), createdAt: Date.now() };
}

/** Compact one-line summary of a preset for list rows. */
export function panelPresetSummary(p: PanelPreset): string {
  const execs = p.executors.map((e) => e.name).join(', ');
  return `${p.executors.length} executors (${execs})`;
}

export function findMatchingPanelPreset(
  list: PanelPresetList,
  executors: PanelModelEntry[],
): PanelPreset | null {
  return (
    list.find(
      (p) =>
        p.executors.length === executors.length &&
        p.executors.every((pe) => executors.some((e) => sameModel(pe, e))),
    ) ?? null
  );
}

/**
 * Cross-checks a preset's models against the live catalog (like
 * `isPresetAvailable`). `custom_openai` is skipped. Returns true when the
 * catalog has not loaded yet so we don't flash a spurious "unavailable" badge.
 */
export function isPanelPresetAvailable(
  preset: PanelPreset,
  modelsData:
    | Record<string, Record<string, { displayName: string }>>
    | undefined,
): boolean {
  if (!modelsData) return true;
  const has = (m: PanelModelEntry): boolean => {
    if (m.provider === 'custom_openai') return true;
    const provider = modelsData[m.provider];
    return !!provider && !!provider[m.name];
  };
  return preset.executors.every(has);
}
