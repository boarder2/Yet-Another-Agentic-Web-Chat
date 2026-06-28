import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from 'react-grid-layout';
import { toast } from 'sonner';
import { useDashboard, type DashboardSurface } from '@/lib/hooks/useDashboard';
import { useConfig } from '@/lib/hooks/api/useConfig';
import { Widget, WidgetConfig, CodeWidgetConfig } from '@/lib/types/widget';
import { CODE_WIDGET_TEMPLATE } from '@/lib/widgets/codeWidgetTemplate';

type ActiveModal = 'none' | 'chooser' | 'llm' | 'code';

/**
 * Shared widget-management glue for both the dashboard and the home surfaces.
 * Wraps `useDashboard`, owns modal/edit state, and exposes the handlers that
 * used to live inline in the dashboard page so the two surfaces stay in sync.
 */
export const useWidgetBoard = (surface: DashboardSurface) => {
  const dashboard = useDashboard();
  const {
    widgets,
    isLoading,
    addWidget,
    updateWidget,
    deleteWidget,
    refreshWidget,
    refreshAllWidgets,
    invalidateWidgetCache,
    setWidgetPlacement,
    getLayouts,
    updateLayouts,
    settings,
    updateSettings,
    exportDashboard,
    importDashboard,
  } = dashboard;

  const { data: appConfig } = useConfig();
  const ceEnabled = !!(
    appConfig?.codeExecution as { enabled?: boolean } | undefined
  )?.enabled;

  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [seedCode, setSeedCode] = useState<string | undefined>(undefined);
  const [isEditMode, setIsEditMode] = useState(false);
  const hasAutoRefreshed = useRef(false);

  // Only the widgets that belong to this surface.
  const surfaceWidgets = useMemo(
    () =>
      widgets.filter((w) =>
        surface === 'home' ? !!w.showOnHome : w.showOnDashboard !== false,
      ),
    [widgets, surface],
  );

  // Existing widgets not yet on this surface — offered for one-click adding from
  // the "Add widget" chooser.
  const addableWidgets = useMemo(
    () =>
      widgets.filter((w) =>
        surface === 'home' ? !w.showOnHome : w.showOnDashboard === false,
      ),
    [widgets, surface],
  );

  // Auto-refresh stale widgets on this surface once per mount (cache-aware).
  useEffect(() => {
    if (!isLoading && surfaceWidgets.length > 0 && !hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      surfaceWidgets.forEach((w) => refreshWidget(w.id));
    }
  }, [isLoading, surfaceWidgets, refreshWidget]);

  const closeModal = useCallback(() => {
    setActiveModal('none');
    setEditingWidget(null);
    setSeedCode(undefined);
  }, []);

  const handleAddWidget = useCallback(() => {
    setEditingWidget(null);
    setSeedCode(undefined);
    // Show the chooser when there's a choice to make: a code-widget option
    // (CE on) and/or existing widgets to re-add. Otherwise jump straight to the
    // AI editor (preserves the original CE-off behavior).
    setActiveModal(ceEnabled || addableWidgets.length > 0 ? 'chooser' : 'llm');
  }, [ceEnabled, addableWidgets.length]);

  const handleChooseKind = useCallback((kind: 'llm' | 'code') => {
    setEditingWidget(null);
    setSeedCode(undefined);
    setActiveModal(kind);
  }, []);

  // Place an existing widget onto this surface (content is shared across
  // surfaces; a cache-aware refresh fills it in if it was never loaded).
  const handleAddExisting = useCallback(
    (widget: Widget) => {
      setWidgetPlacement(
        widget.id,
        surface === 'home' ? { showOnHome: true } : { showOnDashboard: true },
      );
      refreshWidget(widget.id);
      closeModal();
    },
    [setWidgetPlacement, refreshWidget, surface, closeModal],
  );

  const handleEditWidget = useCallback((widget: Widget) => {
    setEditingWidget(widget);
    setSeedCode(undefined);
    setActiveModal(widget.widgetType === 'code' ? 'code' : 'llm');
  }, []);

  // Convert an AI widget to a Code widget: open the code editor pre-seeding the
  // template with the old prompt so it's never silently discarded.
  const handleConvertWidget = useCallback((widget: Widget) => {
    if (widget.widgetType !== 'llm') return;
    setEditingWidget(widget);
    setSeedCode(
      `${CODE_WIDGET_TEMPLATE}\n/* Converted from AI widget. Original prompt:\n${widget.prompt}\n*/\n`,
    );
    setActiveModal('code');
  }, []);

  // Persist, then invalidate that widget's cache and refresh once so the card
  // immediately matches what the user approved.
  const persistAndRefresh = useCallback(
    (id: string) => {
      invalidateWidgetCache(id);
      refreshWidget(id, true);
    },
    [invalidateWidgetCache, refreshWidget],
  );

  const handleSaveWidget = useCallback(
    (widgetConfig: WidgetConfig) => {
      if (editingWidget) {
        updateWidget(editingWidget.id, widgetConfig);
        persistAndRefresh(editingWidget.id);
      } else {
        addWidget(widgetConfig, surface);
      }
      closeModal();
    },
    [
      editingWidget,
      updateWidget,
      persistAndRefresh,
      addWidget,
      surface,
      closeModal,
    ],
  );

  const handleSaveCodeWidget = useCallback(
    (widgetConfig: CodeWidgetConfig) => {
      // Convert flow edits an existing AI widget in place (same id).
      if (editingWidget) {
        updateWidget(editingWidget.id, widgetConfig);
        persistAndRefresh(editingWidget.id);
      } else {
        addWidget(widgetConfig, surface);
      }
      closeModal();
    },
    [
      editingWidget,
      updateWidget,
      persistAndRefresh,
      addWidget,
      surface,
      closeModal,
    ],
  );

  const handleDelete = useCallback(
    (widgetId: string) => deleteWidget(widgetId),
    [deleteWidget],
  );

  const handleRefresh = useCallback(
    (widgetId: string) => refreshWidget(widgetId, true),
    [refreshWidget],
  );

  const handleRefreshAll = useCallback(
    () => refreshAllWidgets(true),
    [refreshAllWidgets],
  );

  const handleTogglePlacement = useCallback(
    (widget: Widget, key: 'home' | 'dashboard') => {
      setWidgetPlacement(
        widget.id,
        key === 'home'
          ? { showOnHome: !widget.showOnHome }
          : { showOnDashboard: widget.showOnDashboard === false },
      );
    },
    [setWidgetPlacement],
  );

  // Persist only on user drag/resize (not on every onLayoutChange) so automatic
  // reflows — e.g. react-grid-layout stacking widgets when the window shrinks —
  // don't overwrite the stored layout. `layout` is the active breakpoint's
  // layout; deriving the other breakpoints from it happens in getLayouts.
  const persistLayout = useCallback(
    (layout: Layout[]) => {
      updateLayouts(surface, layout);
    },
    [updateLayouts, surface],
  );

  const handleExport = useCallback(async () => {
    try {
      const configJson = await exportDashboard();
      await navigator.clipboard.writeText(configJson);
      toast.success('Dashboard configuration copied to clipboard');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to copy dashboard configuration');
    }
  }, [exportDashboard]);

  const handleImport = useCallback(async () => {
    try {
      const configJson = await navigator.clipboard.readText();
      await importDashboard(configJson);
      toast.success('Dashboard configuration imported successfully');
    } catch (error) {
      console.error('Import failed:', error);
      toast.error('Failed to import dashboard configuration');
    }
  }, [importDashboard]);

  const handleToggleProcessingMode = useCallback(() => {
    updateSettings({ parallelLoading: !settings.parallelLoading });
  }, [updateSettings, settings.parallelLoading]);

  const handleToggleHomePeek = useCallback(() => {
    updateSettings({ homeWidgetsPeek: !settings.homeWidgetsPeek });
  }, [updateSettings, settings.homeWidgetsPeek]);

  return {
    // State
    surface,
    surfaceWidgets,
    isLoading,
    isEditMode,
    setIsEditMode,
    settings,
    ceEnabled,

    // Modal state (consumed by <WidgetModals />)
    activeModal,
    editingWidget,
    seedCode,
    addableWidgets,
    closeModal,
    handleChooseKind,
    handleAddExisting,
    handleSaveWidget,
    handleSaveCodeWidget,

    // Widget actions
    handleAddWidget,
    handleEditWidget,
    handleConvertWidget,
    handleDelete,
    handleRefresh,
    handleRefreshAll,
    handleTogglePlacement,

    // Layout + persistence
    getLayouts: () => getLayouts(surface),
    persistLayout,
    handleExport,
    handleImport,
    handleToggleProcessingMode,
    handleToggleHomePeek,
  };
};

export type WidgetBoard = ReturnType<typeof useWidgetBoard>;
