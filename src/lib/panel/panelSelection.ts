/**
 * Device-local composer state for the agent panel: which executor models fan
 * out in parallel. The turn's chat model synthesizes their results, so the
 * panel does not select a model of its own. Persisted to localStorage like
 * other composer prefs and re-sent on each turn via the /api/chat body.
 */

export const PANEL_SELECTION_KEY = 'panelSelection';

export interface PanelModelEntry {
  provider: string;
  name: string;
  contextWindowSize?: number;
  imageCapable?: boolean;
}

export interface PanelSelection {
  enabled: boolean;
  executors: PanelModelEntry[];
}

export const EMPTY_PANEL_SELECTION: PanelSelection = {
  enabled: false,
  executors: [],
};

export const PANEL_MIN = 2;
export const PANEL_MAX = 4;

/** A panel selection is sendable when enabled with 2–4 executors. */
export function isPanelSelectionReady(sel: PanelSelection): boolean {
  return (
    sel.enabled &&
    sel.executors.length >= PANEL_MIN &&
    sel.executors.length <= PANEL_MAX
  );
}

export function sameModel(a: PanelModelEntry, b: PanelModelEntry): boolean {
  return a.provider === b.provider && a.name === b.name;
}
