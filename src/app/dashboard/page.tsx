'use client';

import {
  Plus,
  RefreshCw,
  LoaderCircle,
  Download,
  Upload,
  LayoutDashboard,
  Layers,
  List,
  Pencil,
  Eye,
} from 'lucide-react';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import WidgetConfigModal from '@/components/dashboard/WidgetConfigModal';
import CodeWidgetConfigModal from '@/components/dashboard/CodeWidgetConfigModal';
import WidgetKindChooser from '@/components/dashboard/WidgetKindChooser';
import WidgetDisplay from '@/components/dashboard/WidgetDisplay';
import PageHeader from '@/components/PageHeader';
import { useDashboard } from '@/lib/hooks/useDashboard';
import { useConfig } from '@/lib/hooks/api/useConfig';
import { Widget, WidgetConfig, CodeWidgetConfig } from '@/lib/types/widget';
import { CODE_WIDGET_TEMPLATE } from '@/lib/widgets/codeWidgetTemplate';
import { DashboardLayouts } from '@/lib/types/dashboard';
import { DASHBOARD_CONSTRAINTS } from '@/lib/constants/dashboard';
import { toast } from 'sonner';
import { Layout, Layouts } from 'react-grid-layout';

const ResponsiveGridLayout = WidthProvider(Responsive);

const EmptyDashboard = ({ onAddWidget }: { onAddWidget: () => void }) => (
  <div className="col-span-2 flex justify-center items-center min-h-[400px]">
    <Card className="w-96 text-center">
      <CardHeader>
        <CardTitle>Welcome to your Dashboard</CardTitle>
        <CardDescription>
          Create your first widget to get started with personalized information
        </CardDescription>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-fg/60 mb-4">
          Widgets let you fetch content from any URL and process it with AI to
          show exactly what you need.
        </p>
      </CardContent>

      <CardFooter className="justify-center">
        <button
          type="button"
          onClick={onAddWidget}
          className="px-4 py-2 bg-accent text-accent-fg rounded-control hover:bg-accent-700 transition duration-200 flex items-center space-x-2"
        >
          <Plus size={16} />
          <span>Create Your First Widget</span>
        </button>
      </CardFooter>
    </Card>
  </div>
);

const DashboardPage = () => {
  const {
    widgets,
    isLoading,
    addWidget,
    updateWidget,
    deleteWidget,
    refreshWidget,
    refreshAllWidgets,
    exportDashboard,
    importDashboard,
    invalidateWidgetCache,
    settings,
    updateSettings,
    getLayouts,
    updateLayouts,
  } = useDashboard();

  const { data: appConfig } = useConfig();
  const ceEnabled = !!(
    appConfig?.codeExecution as { enabled?: boolean } | undefined
  )?.enabled;

  // Which editor (if any) is open, and what it's editing.
  const [activeModal, setActiveModal] = useState<
    'none' | 'chooser' | 'llm' | 'code'
  >('none');
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [seedCode, setSeedCode] = useState<string | undefined>(undefined);
  // Normal view (default) renders only widget content; edit mode reveals
  // titles, refresh/sources/actions, and grid drag/resize.
  const [isEditMode, setIsEditMode] = useState(false);
  const hasAutoRefreshed = useRef(false);

  // Memoize the ResponsiveGridLayout to prevent re-renders
  const ResponsiveGrid = useMemo(() => ResponsiveGridLayout, []);

  // Auto-refresh stale widgets when dashboard loads (only once)
  useEffect(() => {
    if (!isLoading && widgets.length > 0 && !hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      refreshAllWidgets();
    }
  }, [isLoading, widgets, refreshAllWidgets]);

  const handleAddWidget = () => {
    setEditingWidget(null);
    setSeedCode(undefined);
    // CE off → no chooser, behavior unchanged (AI widget only).
    setActiveModal(ceEnabled ? 'chooser' : 'llm');
  };

  const handleChooseKind = (kind: 'llm' | 'code') => {
    setEditingWidget(null);
    setSeedCode(undefined);
    setActiveModal(kind);
  };

  const handleEditWidget = (widget: Widget) => {
    setEditingWidget(widget);
    setSeedCode(undefined);
    setActiveModal(widget.widgetType === 'code' ? 'code' : 'llm');
  };

  // Convert an AI widget to a Code widget: open the code editor pre-seeding the
  // template with the old prompt so it's never silently discarded.
  const handleConvertWidget = (widget: Widget) => {
    if (widget.widgetType !== 'llm') return;
    setEditingWidget(widget);
    setSeedCode(
      `${CODE_WIDGET_TEMPLATE}\n/* Converted from AI widget. Original prompt:\n${widget.prompt}\n*/\n`,
    );
    setActiveModal('code');
  };

  // Persist, then invalidate that widget's cache and refresh once so the card
  // immediately matches what the user approved.
  const persistAndRefresh = (id: string) => {
    invalidateWidgetCache(id);
    refreshWidget(id, true);
  };

  const handleSaveWidget = (widgetConfig: WidgetConfig) => {
    if (editingWidget) {
      updateWidget(editingWidget.id, widgetConfig);
      persistAndRefresh(editingWidget.id);
    } else {
      addWidget(widgetConfig);
    }
    handleCloseModal();
  };

  const handleSaveCodeWidget = (widgetConfig: CodeWidgetConfig) => {
    // Convert flow edits an existing AI widget in place (same id).
    if (editingWidget) {
      updateWidget(editingWidget.id, widgetConfig);
      persistAndRefresh(editingWidget.id);
    } else {
      addWidget(widgetConfig);
    }
    handleCloseModal();
  };

  const handleCloseModal = () => {
    setActiveModal('none');
    setEditingWidget(null);
    setSeedCode(undefined);
  };

  const handleDeleteWidget = useCallback(
    (widgetId: string) => {
      deleteWidget(widgetId);
    },
    [deleteWidget],
  );

  const handleRefreshWidget = useCallback(
    (widgetId: string) => {
      refreshWidget(widgetId, true); // Force refresh when manually triggered
    },
    [refreshWidget],
  );

  const handleRefreshAll = () => {
    refreshAllWidgets(true);
  };

  const handleExport = async () => {
    try {
      const configJson = await exportDashboard();
      await navigator.clipboard.writeText(configJson);
      toast.success('Dashboard configuration copied to clipboard');
      console.log('Dashboard configuration copied to clipboard');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to copy dashboard configuration');
    }
  };

  const handleImport = async () => {
    try {
      const configJson = await navigator.clipboard.readText();
      await importDashboard(configJson);
      toast.success('Dashboard configuration imported successfully');
      console.log('Dashboard configuration imported successfully');
    } catch (error) {
      console.error('Import failed:', error);
      toast.error('Failed to import dashboard configuration');
    }
  };

  const handleToggleProcessingMode = () => {
    updateSettings({ parallelLoading: !settings.parallelLoading });
  };

  // Handle layout changes from react-grid-layout
  const handleLayoutChange = (_layout: Layout[], layouts: Layouts) => {
    updateLayouts(layouts as DashboardLayouts);
  };

  // Memoize grid children to prevent unnecessary re-renders
  const gridChildren = useMemo(() => {
    return widgets.map((widget) => (
      <div key={widget.id}>
        <WidgetDisplay
          widget={widget}
          onEdit={handleEditWidget}
          onDelete={handleDeleteWidget}
          onRefresh={handleRefreshWidget}
          onConvert={handleConvertWidget}
          isEditMode={isEditMode}
        />
      </div>
    ));
  }, [widgets, handleDeleteWidget, handleRefreshWidget, isEditMode]);

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        actions={
          <>
            <button
              type="button"
              onClick={() => setIsEditMode((v) => !v)}
              className={`p-2 rounded-surface transition duration-200 ${
                isEditMode
                  ? 'bg-accent text-accent-fg hover:bg-accent-700'
                  : 'hover:bg-surface-2'
              }`}
              title={isEditMode ? 'Switch to View Mode' : 'Switch to Edit Mode'}
            >
              {isEditMode ? <Eye size={18} /> : <Pencil size={18} />}
            </button>

            <button
              type="button"
              onClick={handleRefreshAll}
              className="p-2 hover:bg-surface-2 rounded-surface transition duration-200"
              title="Refresh All Widgets"
            >
              <RefreshCw size={18} />
            </button>

            {isEditMode && (
              <>
                <button
                  type="button"
                  onClick={handleToggleProcessingMode}
                  className="p-2 hover:bg-surface-2 rounded-surface transition duration-200"
                  title={`Switch to ${settings.parallelLoading ? 'Sequential' : 'Parallel'} Processing`}
                >
                  {settings.parallelLoading ? (
                    <Layers size={18} />
                  ) : (
                    <List size={18} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleExport}
                  className="p-2 hover:bg-surface-2 rounded-surface transition duration-200"
                  title="Export Dashboard Configuration"
                >
                  <Download size={18} />
                </button>

                <button
                  type="button"
                  onClick={handleImport}
                  className="p-2 hover:bg-surface-2 rounded-surface transition duration-200"
                  title="Import Dashboard Configuration"
                >
                  <Upload size={18} />
                </button>

                <button
                  type="button"
                  onClick={handleAddWidget}
                  className="p-2 bg-accent hover:bg-accent-700 rounded-surface transition duration-200"
                  title="Add New Widget"
                >
                  <Plus size={18} />
                </button>
              </>
            )}
          </>
        }
      />

      {/* Main content area */}
      <div className="flex-1 pb-20 lg:pb-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <LoaderCircle
                size={32}
                className="animate-spin mx-auto mb-4 text-accent"
              />
              <p className="text-fg/60">Loading dashboard...</p>
            </div>
          </div>
        ) : widgets.length === 0 ? (
          <EmptyDashboard onAddWidget={handleAddWidget} />
        ) : (
          <ResponsiveGrid
            className="layout"
            layouts={getLayouts()}
            breakpoints={DASHBOARD_CONSTRAINTS.GRID_BREAKPOINTS}
            cols={DASHBOARD_CONSTRAINTS.GRID_COLUMNS}
            rowHeight={DASHBOARD_CONSTRAINTS.GRID_ROW_HEIGHT}
            margin={DASHBOARD_CONSTRAINTS.GRID_MARGIN}
            containerPadding={DASHBOARD_CONSTRAINTS.GRID_CONTAINER_PADDING}
            onLayoutChange={handleLayoutChange}
            isDraggable={isEditMode}
            isResizable={isEditMode}
            compactType="vertical"
            preventCollision={false}
            draggableHandle=".widget-drag-handle"
          >
            {gridChildren}
          </ResponsiveGrid>
        )}
      </div>

      {/* Widget kind chooser */}
      <WidgetKindChooser
        isOpen={activeModal === 'chooser'}
        onClose={handleCloseModal}
        onChoose={handleChooseKind}
      />

      {/* AI (LLM) widget editor */}
      <WidgetConfigModal
        isOpen={activeModal === 'llm'}
        onClose={handleCloseModal}
        onSave={handleSaveWidget}
        editingWidget={
          editingWidget?.widgetType === 'llm' ? editingWidget : null
        }
      />

      {/* Code widget editor (also used by the convert flow) */}
      <CodeWidgetConfigModal
        isOpen={activeModal === 'code'}
        onClose={handleCloseModal}
        onSave={handleSaveCodeWidget}
        editingWidget={
          editingWidget?.widgetType === 'code' ? editingWidget : null
        }
        seedCode={seedCode}
      />
    </div>
  );
};

export default DashboardPage;
