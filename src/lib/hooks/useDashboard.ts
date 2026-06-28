import { useState, useEffect, useCallback } from 'react';
import { Layout } from 'react-grid-layout';
import { Widget, WidgetConfig, WidgetLayout } from '@/lib/types/widget';
import {
  DashboardState,
  DashboardConfig,
  DashboardLayouts,
  DASHBOARD_STORAGE_KEYS,
  migrateDashboardStorage,
} from '@/lib/types/dashboard';
import { WidgetCache } from '@/lib/types/cache';
import {
  isSettingsHydrated,
  subscribeSettingsHydrated,
  subscribeSettingsSynced,
} from '@/lib/settings/persist';
import {
  DASHBOARD_CONSTRAINTS,
  getResponsiveConstraints,
} from '@/lib/constants/dashboard';
import { resolveWidgetTheme } from '@/lib/widgets/widgetTheme';

// Helper function to request location permission and get user's location
const requestLocationPermission = async (): Promise<string | undefined> => {
  try {
    if (!navigator.geolocation) {
      console.warn('Geolocation is not supported by this browser');
      return undefined;
    }

    return new Promise((resolve, _reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          resolve(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        },
        (error) => {
          console.warn('Location access denied or failed:', error.message);
          // Don't reject, just return undefined to continue without location
          resolve(undefined);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000, // 10 seconds timeout
          maximumAge: 300000, // 5 minutes cache
        },
      );
    });
  } catch (error) {
    console.warn('Error requesting location:', error);
    return undefined;
  }
};

// Helper function to replace date/time variables in prompts on the client side
const replaceDateTimeVariables = (prompt: string): string => {
  let processedPrompt = prompt;

  // Replace UTC datetime
  if (processedPrompt.includes('{{current_utc_datetime}}')) {
    const utcDateTime = new Date().toISOString();
    processedPrompt = processedPrompt.replace(
      /\{\{current_utc_datetime\}\}/g,
      utcDateTime,
    );
  }

  // Replace local datetime
  if (processedPrompt.includes('{{current_local_datetime}}')) {
    const now = new Date();
    const localDateTime = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000,
    ).toISOString();
    processedPrompt = processedPrompt.replace(
      /\{\{current_local_datetime\}\}/g,
      localDateTime,
    );
  }

  return processedPrompt;
};

// Widgets render on two independent surfaces. Layout + placement operations are
// surface-aware so a widget shown on both keeps a separate position per surface.
export type DashboardSurface = 'home' | 'dashboard';

interface UseDashboardReturn {
  // State
  widgets: Widget[];
  isLoading: boolean;
  error: string | null;
  settings: DashboardConfig['settings'];

  // Widget management
  addWidget: (config: WidgetConfig, surface?: DashboardSurface) => void;
  updateWidget: (id: string, config: WidgetConfig) => void;
  deleteWidget: (id: string) => void;
  refreshWidget: (id: string, forceRefresh?: boolean) => Promise<void>;
  refreshAllWidgets: (forceRefresh?: boolean) => Promise<void>;
  setWidgetPlacement: (
    id: string,
    patch: { showOnHome?: boolean; showOnDashboard?: boolean },
  ) => void;

  // Layout management. `layout` is the currently-active breakpoint's layout
  // (react-grid-layout's first onLayoutChange arg) — using it, rather than a
  // fixed breakpoint, lets edits made at any width persist.
  updateLayouts: (surface: DashboardSurface, layout: Layout[]) => void;
  getLayouts: (surface: DashboardSurface) => DashboardLayouts;

  // Storage management
  exportDashboard: () => Promise<string>;
  importDashboard: (configJson: string) => Promise<void>;
  clearCache: () => void;
  invalidateWidgetCache: (id: string) => void;

  // Settings
  updateSettings: (newSettings: Partial<DashboardConfig['settings']>) => void;
}

// `showOnDashboard === undefined` means "show" (back-compat with widgets created
// before home placement existed). Home is strictly opt-in.
const isOnSurface = (w: Widget, surface: DashboardSurface): boolean =>
  surface === 'home' ? !!w.showOnHome : w.showOnDashboard !== false;

// The per-surface position field. Home falls back to the dashboard layout when a
// home layout hasn't been seeded yet (e.g. imported widgets).
const surfaceLayout = (w: Widget, surface: DashboardSurface): WidgetLayout =>
  surface === 'home' ? (w.homeLayout ?? w.layout) : w.layout;

// First free grid slot among the given layouts (half-width widgets, scanning
// top-to-bottom). Mirrors the original dashboard placement heuristic.
const findOpenPosition = (
  layouts: WidgetLayout[],
): { x: number; y: number } => {
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 12; col += 6) {
      const position = { x: col, y: row };
      const hasCollision = layouts.some(
        (l) =>
          l.x < position.x + 6 &&
          l.x + l.w > position.x &&
          l.y < position.y + 3 &&
          l.y + l.h > position.y,
      );
      if (!hasCollision) return position;
    }
  }
  const maxY = Math.max(0, ...layouts.map((l) => l.y + l.h));
  return { x: 0, y: maxY };
};

const getWidgetCache = (): WidgetCache => {
  try {
    const cached = localStorage.getItem(DASHBOARD_STORAGE_KEYS.CACHE);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
};

export const useDashboard = (): UseDashboardReturn => {
  const [state, setState] = useState<DashboardState>({
    widgets: [],
    isLoading: true, // Start as loading
    error: null,
    settings: {
      parallelLoading: true,
      autoRefresh: false,
      theme: 'auto',
    },
  });

  // Dashboard storage is DB-backed (app_settings) with localStorage as a cache.
  // We must not persist our loaded state until settings hydration has reconciled
  // with the DB, or a stale local-on-mount snapshot could clobber newer values
  // another device wrote. Until then, write-backs are gated off.
  const [settingsHydrated, setSettingsHydrated] = useState<boolean>(() =>
    isSettingsHydrated(),
  );

  const loadDashboardData = useCallback(() => {
    try {
      // Migrate legacy Perplexica localStorage keys if present
      migrateDashboardStorage();

      // Load widgets
      const savedWidgets = localStorage.getItem(DASHBOARD_STORAGE_KEYS.WIDGETS);
      const widgets: Widget[] = savedWidgets ? JSON.parse(savedWidgets) : [];

      // Convert date strings back to Date objects and ensure layout exists
      widgets.forEach((widget, index) => {
        // Migration: legacy widgets predate the discriminated union.
        const w = widget as unknown as { widgetType?: 'llm' | 'code' };
        if (!w.widgetType) w.widgetType = 'llm';

        if (widget.lastUpdated) {
          widget.lastUpdated = new Date(widget.lastUpdated);
        }

        // Migration: Add default layout if missing
        if (!widget.layout) {
          const defaultLayout: WidgetLayout = {
            x: (index % 2) * 6, // Alternate between columns
            y: Math.floor(index / 2) * 4, // Stack rows
            w: DASHBOARD_CONSTRAINTS.DEFAULT_WIDGET_WIDTH,
            h: DASHBOARD_CONSTRAINTS.DEFAULT_WIDGET_HEIGHT,
            isDraggable: true,
            isResizable: true,
          };
          widget.layout = defaultLayout;
        }
      });

      // Load settings
      const savedSettings = localStorage.getItem(
        DASHBOARD_STORAGE_KEYS.SETTINGS,
      );
      const settings = savedSettings
        ? JSON.parse(savedSettings)
        : {
            parallelLoading: true,
            autoRefresh: false,
            theme: 'auto',
          };

      setState((prev) => ({
        ...prev,
        widgets,
        settings,
        // Stay "loading" until settings hydration has reconciled with the DB.
        // Reporting ready on the pre-hydration (stale) snapshot lets the
        // dashboard's auto-refresh fire against old cache and race the
        // freshly-hydrated values, intermittently re-applying stale renders.
        isLoading: !isSettingsHydrated(),
      }));
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      setState((prev) => ({
        ...prev,
        error: 'Failed to load dashboard data',
        isLoading: false,
      }));
    }
  }, []);

  // Load dashboard data from localStorage on mount. The synchronous setState
  // is intentional: it hydrates the dashboard from persisted storage in a
  // single pass before first paint.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboardData();
  }, [loadDashboardData]);

  // When settings hydration reconciles with the DB, pull the freshly-hydrated
  // values into state and unblock write-backs. Fires immediately if hydration
  // already completed before this hook mounted.
  useEffect(() => {
    return subscribeSettingsHydrated(() => {
      setSettingsHydrated(true);
      loadDashboardData();
    });
  }, [loadDashboardData]);

  // Re-read the cache whenever a focus/visibility re-sync pulls newer values
  // from the DB, so a long-lived tab reflects changes made on another device.
  useEffect(() => {
    return subscribeSettingsSynced(loadDashboardData);
  }, [loadDashboardData]);

  // Save widgets to localStorage whenever they change (not on initial load, and
  // not before hydration — see settingsHydrated note above).
  useEffect(() => {
    if (!state.isLoading && settingsHydrated) {
      localStorage.setItem(
        DASHBOARD_STORAGE_KEYS.WIDGETS,
        JSON.stringify(state.widgets),
      );
    }
  }, [state.widgets, state.isLoading, settingsHydrated]);

  // Save settings to localStorage whenever they change (gated the same way).
  useEffect(() => {
    if (!state.isLoading && settingsHydrated) {
      localStorage.setItem(
        DASHBOARD_STORAGE_KEYS.SETTINGS,
        JSON.stringify(state.settings),
      );
    }
  }, [state.settings, state.isLoading, settingsHydrated]);

  const addWidget = useCallback(
    (config: WidgetConfig, surface: DashboardSurface = 'dashboard') => {
      // Position only against widgets already on the target surface.
      const occupied = state.widgets
        .filter((w) => isOnSurface(w, surface))
        .map((w) => surfaceLayout(w, surface));
      const position = findOpenPosition(occupied);
      const defaultLayout: WidgetLayout = {
        x: position.x,
        y: position.y,
        w: DASHBOARD_CONSTRAINTS.DEFAULT_WIDGET_WIDTH,
        h: DASHBOARD_CONSTRAINTS.DEFAULT_WIDGET_HEIGHT,
        isDraggable: true,
        isResizable: true,
      };

      // New widgets get BOTH placement flags set explicitly so a home-created
      // widget isn't accidentally treated as "show on dashboard" by the
      // undefined-means-true back-compat rule.
      const newWidget: Widget = {
        ...config,
        showOnHome: surface === 'home' ? true : (config.showOnHome ?? false),
        showOnDashboard:
          surface === 'dashboard' ? true : (config.showOnDashboard ?? false),
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        lastUpdated: null,
        isLoading: false,
        content: null,
        error: null,
        layout:
          config.layout ??
          (surface === 'dashboard' ? defaultLayout : { ...defaultLayout }),
        homeLayout:
          surface === 'home'
            ? (config.homeLayout ?? defaultLayout)
            : config.homeLayout,
      };

      setState((prev) => ({
        ...prev,
        widgets: [...prev.widgets, newWidget],
      }));
    },
    [state.widgets],
  );

  // Replace-not-merge: take ALL config-bearing fields from the new
  // discriminated `config`, keeping only runtime status + id + layout from the
  // prior widget. A spread-merge would leave stale prompt/provider/model on a
  // widget switched to `code`, corrupting the persisted union. Callers must
  // therefore pass a COMPLETE discriminated config, not a partial patch.
  const updateWidget = useCallback((id: string, config: WidgetConfig) => {
    setState((prev) => ({
      ...prev,
      widgets: prev.widgets.map((widget) =>
        widget.id === id
          ? ({
              ...config,
              id,
              layout: config.layout || widget.layout,
              lastUpdated: widget.lastUpdated,
              isLoading: widget.isLoading,
              content: widget.content,
              error: widget.error,
              charts: widget.charts,
            } as Widget)
          : widget,
      ),
    }));
  }, []);

  const deleteWidget = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((widget) => widget.id !== id),
    }));

    // Also remove from cache
    const cache = getWidgetCache();
    const { [id]: _, ...newCache } = cache;
    localStorage.setItem(
      DASHBOARD_STORAGE_KEYS.CACHE,
      JSON.stringify(newCache),
    );
  }, []);

  // Flip placement flags only (never reconstruct the discriminated config — see
  // updateWidget's replace-not-merge note). When a widget is newly placed on
  // home and has no home layout yet, seed one in a free slot.
  const setWidgetPlacement = useCallback(
    (
      id: string,
      patch: { showOnHome?: boolean; showOnDashboard?: boolean },
    ) => {
      setState((prev) => {
        const seedingHome =
          patch.showOnHome === true &&
          !prev.widgets.find((w) => w.id === id)?.homeLayout;
        const homeOccupied = seedingHome
          ? prev.widgets
              .filter((w) => isOnSurface(w, 'home'))
              .map((w) => surfaceLayout(w, 'home'))
          : [];
        return {
          ...prev,
          widgets: prev.widgets.map((w) => {
            if (w.id !== id) return w;
            const next: Widget = { ...w, ...patch };
            if (seedingHome) {
              const position = findOpenPosition(homeOccupied);
              next.homeLayout = {
                x: position.x,
                y: position.y,
                w: DASHBOARD_CONSTRAINTS.DEFAULT_WIDGET_WIDTH,
                h: DASHBOARD_CONSTRAINTS.DEFAULT_WIDGET_HEIGHT,
                isDraggable: true,
                isResizable: true,
              };
            }
            return next;
          }),
        };
      });
    },
    [],
  );

  const isWidgetCacheValid = useCallback((widget: Widget): boolean => {
    const cache = getWidgetCache();
    const cachedData = cache[widget.id];

    if (!cachedData) return false;

    const now = new Date();
    const expiresAt = new Date(cachedData.expiresAt);

    return now < expiresAt;
  }, []);

  const getCacheExpiryTime = useCallback((widget: Widget): Date => {
    const now = new Date();
    const refreshMs =
      widget.refreshFrequency *
      (widget.refreshUnit === 'hours' ? 3600000 : 60000);
    return new Date(now.getTime() + refreshMs);
  }, []);

  const refreshWidget = useCallback(
    async (id: string, forceRefresh: boolean = false) => {
      const widget = state.widgets.find((w) => w.id === id);
      if (!widget) return;

      // Check cache first (unless forcing refresh)
      if (!forceRefresh && isWidgetCacheValid(widget)) {
        const cache = getWidgetCache();
        const cachedData = cache[widget.id];
        setState((prev) => ({
          ...prev,
          widgets: prev.widgets.map((w) =>
            w.id === id
              ? {
                  ...w,
                  content: cachedData.content,
                  charts: cachedData.charts,
                  lastUpdated: new Date(cachedData.lastFetched),
                }
              : w,
          ),
        }));
        return;
      }

      // Set loading state
      setState((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) =>
          w.id === id ? { ...w, isLoading: true, error: null } : w,
        ),
      }));

      // Resolve the user's current theme so the widget output matches it.
      const theme = resolveWidgetTheme();

      try {
        // Branch on widgetType BEFORE touching any llm-only field (prompt).
        let response: Response;
        if (widget.widgetType === 'code') {
          // Only request geolocation when the saved code actually references
          // `location`. Strip comments first (so the template's docs or a stray
          // "// ...location..." note never prompt) and match it as a whole word
          // (so "allocation"/"relocation" don't either). The seed template omits
          // `location` from render()'s args, making it strictly opt-in.
          const codeSansComments = widget.code
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
          const location = /\blocation\b/.test(codeSansComments)
            ? await requestLocationPermission()
            : undefined;
          response = await fetch('/api/dashboard/process-code-widget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: widget.code,
              sources: widget.sources,
              location,
              theme,
            }),
          });
        } else {
          let location: string | undefined;
          if (widget.prompt.includes('{{location}}')) {
            location = await requestLocationPermission();
          }
          const processedPrompt = replaceDateTimeVariables(widget.prompt);
          response = await fetch('/api/dashboard/process-widget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sources: widget.sources,
              prompt: processedPrompt,
              provider: widget.provider,
              model: widget.model,
              tool_names: widget.tool_names,
              location,
              theme,
            }),
          });
        }

        const result = await response.json();
        const now = new Date();

        if (result.success) {
          const charts = result.charts as Widget['charts'];
          // Update widget
          setState((prev) => ({
            ...prev,
            widgets: prev.widgets.map((w) =>
              w.id === id
                ? {
                    ...w,
                    isLoading: false,
                    content: result.content,
                    charts,
                    lastUpdated: now,
                    error: null,
                  }
                : w,
            ),
          }));

          // Cache the result
          const cache = getWidgetCache();
          cache[id] = {
            content: result.content,
            charts,
            lastFetched: now,
            expiresAt: getCacheExpiryTime(widget),
          };
          localStorage.setItem(
            DASHBOARD_STORAGE_KEYS.CACHE,
            JSON.stringify(cache),
          );
        } else {
          setState((prev) => ({
            ...prev,
            widgets: prev.widgets.map((w) =>
              w.id === id
                ? {
                    ...w,
                    isLoading: false,
                    error: result.error || 'Failed to refresh widget',
                  }
                : w,
            ),
          }));
        }
      } catch (_error) {
        setState((prev) => ({
          ...prev,
          widgets: prev.widgets.map((w) =>
            w.id === id
              ? {
                  ...w,
                  isLoading: false,
                  error: 'Network error: Failed to refresh widget',
                }
              : w,
          ),
        }));
      }
    },
    [state.widgets, isWidgetCacheValid, getCacheExpiryTime],
  );

  const refreshAllWidgets = useCallback(
    async (forceRefresh = false) => {
      const activeWidgets = state.widgets.filter((w) => !w.isLoading);

      if (state.settings.parallelLoading) {
        // Refresh all widgets in parallel (force refresh)
        await Promise.all(
          activeWidgets.map((widget) => refreshWidget(widget.id, forceRefresh)),
        );
      } else {
        // Refresh widgets sequentially (force refresh)
        for (const widget of activeWidgets) {
          await refreshWidget(widget.id, forceRefresh);
        }
      }
    },
    [state.widgets, state.settings.parallelLoading, refreshWidget],
  );

  const exportDashboard = useCallback(async (): Promise<string> => {
    const dashboardConfig: DashboardConfig = {
      widgets: state.widgets,
      settings: state.settings,
      lastExport: new Date(),
      version: '1.0.0',
    };

    return JSON.stringify(dashboardConfig, null, 2);
  }, [state.widgets, state.settings]);

  const importDashboard = useCallback(
    async (configJson: string): Promise<void> => {
      try {
        const config: DashboardConfig = JSON.parse(configJson);

        // Validate the config structure
        if (!config.widgets || !Array.isArray(config.widgets)) {
          throw new Error(
            'Invalid dashboard configuration: missing or invalid widgets array',
          );
        }

        // Process widgets and ensure they have valid IDs
        const processedWidgets: Widget[] = config.widgets.map(
          (widget) =>
            ({
              ...widget,
              // Migration: backfill widgetType on legacy exported JSON.
              widgetType:
                (widget as unknown as { widgetType?: 'llm' | 'code' })
                  .widgetType ?? 'llm',
              id:
                widget.id ||
                Date.now().toString() + Math.random().toString(36).substr(2, 9),
              lastUpdated: widget.lastUpdated
                ? new Date(widget.lastUpdated)
                : null,
              isLoading: false,
              content: widget.content || null,
              error: null,
            }) as Widget,
        );

        setState((prev) => ({
          ...prev,
          widgets: processedWidgets,
          settings: { ...prev.settings, ...config.settings },
        }));
      } catch (error) {
        throw new Error(
          `Failed to import dashboard: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
        );
      }
    },
    [],
  );

  const clearCache = useCallback(() => {
    localStorage.removeItem(DASHBOARD_STORAGE_KEYS.CACHE);
  }, []);

  const invalidateWidgetCache = useCallback((id: string) => {
    const cache = getWidgetCache();
    const { [id]: _, ...rest } = cache;
    localStorage.setItem(DASHBOARD_STORAGE_KEYS.CACHE, JSON.stringify(rest));
  }, []);

  const updateSettings = useCallback(
    (newSettings: Partial<DashboardConfig['settings']>) => {
      setState((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...newSettings },
      }));
    },
    [],
  );

  const getLayouts = useCallback(
    (surface: DashboardSurface): DashboardLayouts => {
      const onSurface = state.widgets.filter((w) => isOnSurface(w, surface));
      const createBreakpointLayout = (
        breakpoint: keyof typeof DASHBOARD_CONSTRAINTS.GRID_COLUMNS,
      ) => {
        const constraints = getResponsiveConstraints(breakpoint);
        const maxCols = DASHBOARD_CONSTRAINTS.GRID_COLUMNS[breakpoint];

        return onSurface.map((widget) => {
          const layout = surfaceLayout(widget, surface);
          return {
            i: widget.id,
            x: layout.x,
            y: layout.y,
            w: Math.min(layout.w, maxCols), // Constrain width to available columns
            h: layout.h,
            minW: constraints.minW,
            maxW: constraints.maxW,
            minH: constraints.minH,
            maxH: constraints.maxH,
            static: layout.static,
            isDraggable: layout.isDraggable,
            isResizable: layout.isResizable,
          };
        });
      };

      return {
        lg: createBreakpointLayout('lg'),
        md: createBreakpointLayout('md'),
        sm: createBreakpointLayout('sm'),
        xs: createBreakpointLayout('xs'),
        xxs: createBreakpointLayout('xxs'),
      };
    },
    [state.widgets],
  );

  const updateLayouts = useCallback(
    (surface: DashboardSurface, layout: Layout[]) => {
      const field = surface === 'home' ? 'homeLayout' : 'layout';
      const updatedWidgets = state.widgets.map((widget) => {
        const newLayout = layout.find((l: Layout) => l.i === widget.id);
        if (newLayout) {
          const prevLayout = surfaceLayout(widget, surface);
          return {
            ...widget,
            [field]: {
              x: newLayout.x,
              y: newLayout.y,
              w: newLayout.w,
              h: newLayout.h,
              static: newLayout.static || prevLayout.static,
              isDraggable: newLayout.isDraggable ?? prevLayout.isDraggable,
              isResizable: newLayout.isResizable ?? prevLayout.isResizable,
            },
          };
        }
        return widget;
      });

      setState((prev) => ({
        ...prev,
        widgets: updatedWidgets,
      }));
    },
    [state.widgets],
  );

  return {
    // State
    widgets: state.widgets,
    isLoading: state.isLoading,
    error: state.error,
    settings: state.settings,

    // Widget management
    addWidget,
    updateWidget,
    deleteWidget,
    refreshWidget,
    refreshAllWidgets,
    setWidgetPlacement,

    // Layout management
    updateLayouts,
    getLayouts,

    // Storage management
    exportDashboard,
    importDashboard,
    clearCache,
    invalidateWidgetCache,

    // Settings
    updateSettings,
  };
};
