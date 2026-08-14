'use client';

import {
  Plus,
  RefreshCw,
  Download,
  Upload,
  LayoutDashboard,
  Layers,
  List,
  Pencil,
  Eye,
} from 'lucide-react';
import { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import WidgetDisplay from '@/components/dashboard/WidgetDisplay';
import WidgetModals from '@/components/dashboard/WidgetModals';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import { useWidgetBoard } from '@/lib/hooks/useWidgetBoard';
import { DASHBOARD_CONSTRAINTS } from '@/lib/constants/dashboard';

const ResponsiveGridLayout = WidthProvider(Responsive);

const EmptyDashboard = ({ onAddWidget }: { onAddWidget: () => void }) => (
  <ListEmptyState
    layout="page"
    className="col-span-2 min-h-[400px]"
    title="Welcome to your Dashboard"
    body={
      <>
        <p>
          Create your first widget to get started with personalized information
        </p>
        <p className="mt-2">
          Widgets let you fetch content from any URL and process it with AI to
          show exactly what you need.
        </p>
      </>
    }
    action={
      <Button variant="primary" icon={Plus} onClick={onAddWidget}>
        Create Your First Widget
      </Button>
    }
  />
);

const DashboardPage = () => {
  const board = useWidgetBoard('dashboard');
  const {
    surfaceWidgets,
    isLoading,
    isEditMode,
    setIsEditMode,
    settings,
    handleAddWidget,
    handleEditWidget,
    handleConvertWidget,
    handleDelete,
    handleRefresh,
    handleRefreshAll,
    handleTogglePlacement,
    persistLayout,
    handleExport,
    handleImport,
    handleToggleProcessingMode,
    getLayouts,
  } = board;

  // Memoize grid children to prevent unnecessary re-renders
  const gridChildren = useMemo(() => {
    return surfaceWidgets.map((widget) => (
      <div key={widget.id}>
        <WidgetDisplay
          widget={widget}
          onEdit={handleEditWidget}
          onDelete={handleDelete}
          onRefresh={handleRefresh}
          onConvert={handleConvertWidget}
          onTogglePlacement={handleTogglePlacement}
          isEditMode={isEditMode}
        />
      </div>
    ));
  }, [
    surfaceWidgets,
    handleEditWidget,
    handleDelete,
    handleRefresh,
    handleConvertWidget,
    handleTogglePlacement,
    isEditMode,
  ]);

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        actions={
          <>
            <IconButton
              icon={isEditMode ? Eye : Pencil}
              label={isEditMode ? 'Switch to View Mode' : 'Switch to Edit Mode'}
              tone={isEditMode ? 'active' : 'default'}
              aria-pressed={isEditMode}
              onClick={() => setIsEditMode((v) => !v)}
            />

            <IconButton
              icon={RefreshCw}
              label="Refresh All Widgets"
              onClick={handleRefreshAll}
            />

            {isEditMode && (
              <>
                <IconButton
                  icon={settings.parallelLoading ? Layers : List}
                  label={`Switch to ${settings.parallelLoading ? 'Sequential' : 'Parallel'} Processing`}
                  aria-pressed={settings.parallelLoading}
                  onClick={handleToggleProcessingMode}
                />
                <IconButton
                  icon={Download}
                  label="Export Dashboard Configuration"
                  onClick={handleExport}
                />
                <IconButton
                  icon={Upload}
                  label="Import Dashboard Configuration"
                  onClick={handleImport}
                />
                <IconButton
                  icon={Plus}
                  label="Add New Widget"
                  tone="primary"
                  onClick={handleAddWidget}
                />
              </>
            )}
          </>
        }
      />

      {/* Main content area */}
      <div className="flex-1 pb-20 lg:pb-2">
        {isLoading ? (
          <ListLoading layout="page" size={32} status="Loading dashboard..." />
        ) : surfaceWidgets.length === 0 ? (
          <EmptyDashboard onAddWidget={handleAddWidget} />
        ) : (
          <ResponsiveGridLayout
            className="layout"
            layouts={getLayouts()}
            breakpoints={DASHBOARD_CONSTRAINTS.GRID_BREAKPOINTS}
            cols={DASHBOARD_CONSTRAINTS.GRID_COLUMNS}
            rowHeight={DASHBOARD_CONSTRAINTS.GRID_ROW_HEIGHT}
            margin={DASHBOARD_CONSTRAINTS.GRID_MARGIN}
            containerPadding={DASHBOARD_CONSTRAINTS.GRID_CONTAINER_PADDING}
            onDragStop={persistLayout}
            onResizeStop={persistLayout}
            isDraggable={isEditMode}
            isResizable={isEditMode}
            compactType="vertical"
            preventCollision={false}
            draggableHandle=".widget-drag-handle"
          >
            {gridChildren}
          </ResponsiveGridLayout>
        )}
      </div>

      <WidgetModals board={board} />
    </div>
  );
};

export default DashboardPage;
