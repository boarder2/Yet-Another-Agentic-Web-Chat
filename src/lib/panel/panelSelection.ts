/**
 * Device-local composer state for the agent panel: which executor models fan
 * out in parallel. The turn's chat model synthesizes their results, so the
 * panel does not select a model of its own. Persisted to localStorage like
 * other composer prefs and re-sent on each turn via the /api/chat body.
 */

import { PANEL_MIN_EXECUTORS, PANEL_MAX_EXECUTORS } from '@/lib/types/panel';
import type { ModelRef } from '@/lib/providers/resolveModels';

export const PANEL_SELECTION_KEY = 'panelSelection';

export type PanelModelEntry = ModelRef & {
  imageCapable?: boolean;
};

export interface PanelSelection {
  enabled: boolean;
  executors: PanelModelEntry[];
}

export const EMPTY_PANEL_SELECTION: PanelSelection = {
  enabled: false,
  executors: [],
};

// Aliases of the canonical executor bounds in the request contract, kept under
// the shorter composer-facing names used throughout the panel UI.
export const PANEL_MIN = PANEL_MIN_EXECUTORS;
export const PANEL_MAX = PANEL_MAX_EXECUTORS;

/** Whether the selection holds a usable executor set, regardless of on/off. */
export function hasValidExecutors(sel: PanelSelection): boolean {
  return sel.executors.length >= PANEL_MIN && sel.executors.length <= PANEL_MAX;
}

/** A panel selection is sendable when enabled with 2–4 executors. */
export function isPanelSelectionReady(sel: PanelSelection): boolean {
  return sel.enabled && hasValidExecutors(sel);
}

export function sameModel(a: PanelModelEntry, b: PanelModelEntry): boolean {
  return a.provider === b.provider && a.name === b.name;
}

/** Compare a persisted executor identity and its configured effort. */
export function sameModelConfiguration(
  a: PanelModelEntry,
  b: PanelModelEntry,
): boolean {
  return (
    sameModel(a, b) &&
    (a.reasoningEffort ?? undefined) === (b.reasoningEffort ?? undefined)
  );
}
