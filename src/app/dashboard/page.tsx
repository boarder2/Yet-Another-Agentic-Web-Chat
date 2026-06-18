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
import { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import WidgetDisplay from '@/components/dashboard/WidgetDisplay';
import WidgetModals from '@/components/dashboard/WidgetModals';
import PageHeader from '@/components/PageHeader';
import { useWidgetBoard } from '@/lib/hooks/useWidgetBoard';
import { DASHBOARD_CONSTRAINTS } from '@/lib/constants/dashboard';

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
