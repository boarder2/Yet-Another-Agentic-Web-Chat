// Dashboard configuration and state types
import { Widget, WidgetLayout } from './widget';
import { Layout } from 'react-grid-layout';

export interface DashboardConfig {
  widgets: Widget[];
  settings: {
    parallelLoading: boolean;
    autoRefresh: boolean;
    theme: 'auto' | 'light' | 'dark';
  };
  lastExport?: Date;
  version: string;
}

export interface DashboardState {
  widgets: Widget[];
  isLoading: boolean;
  error: string | null;
  settings: DashboardConfig['settings'];
}

// Layout item for react-grid-layout (extends WidgetLayout with required 'i' property)
export interface GridLayoutItem extends WidgetLayout {
  i: string; // Widget ID
}

// Layout configuration for responsive grid (compatible with react-grid-layout)
export interface DashboardLayouts {
  lg: Layout[];
  md: Layout[];
  sm: Layout[];
  xs: Layout[];
  xxs: Layout[];
  [key: string]: Layout[]; // Index signature for react-grid-layout compatibility
}

// Local storage keys
export const DASHBOARD_STORAGE_KEYS = {
  WIDGETS: 'yaawc_dashboard_widgets',
  SETTINGS: 'yaawc_dashboard_settings',
  CACHE: 'yaawc_dashboard_cache',
  LAYOUTS: 'yaawc_dashboard_layouts',
} as const;

// Legacy keys from before the Perplexica → YAAWC rebrand
const LEGACY_STORAGE_KEYS: Record<string, string> = {
  perplexica_dashboard_widgets: DASHBOARD_STORAGE_KEYS.WIDGETS,
  perplexica_dashboard_settings: DASHBOARD_STORAGE_KEYS.SETTINGS,
  perplexica_dashboard_cache: DASHBOARD_STORAGE_KEYS.CACHE,
  perplexica_dashboard_layouts: DASHBOARD_STORAGE_KEYS.LAYOUTS,
};

/**
 * Migrates legacy `perplexica_dashboard_*` localStorage keys to `yaawc_dashboard_*`.
 * Copies values only when the new key doesn't already exist, then removes the old key.
 * Safe to call multiple times — no-ops once migration is complete.
 */
export function migrateDashboardStorage(): void {
  if (typeof window === 'undefined') return;
  for (const [oldKey, newKey] of Object.entries(LEGACY_STORAGE_KEYS)) {
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, oldValue);
    }
    if (oldValue !== null) {
      localStorage.removeItem(oldKey);
    }
  }
}
