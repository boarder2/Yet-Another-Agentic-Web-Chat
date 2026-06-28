'use client';

import { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import WidgetDisplay from '@/components/dashboard/WidgetDisplay';
import { DASHBOARD_CONSTRAINTS } from '@/lib/constants/dashboard';
import type { WidgetBoard } from '@/lib/hooks/useWidgetBoard';

const ResponsiveGridLayout = WidthProvider(Responsive);

/**
 * The home-page widget grid (same responsive grid as the dashboard).
 * Presentational — the `board` (state + handlers) is owned by the parent so the
 * underlying `useDashboard` mounts once. Management controls live in the
 * separate <HomeWidgetToolbar />; the modal trio in <WidgetModals />.
 */
const HomeWidgetBoard = ({ board }: { board: WidgetBoard }) => {
  const {
    surfaceWidgets,
    isEditMode,
    handleEditWidget,
    handleConvertWidget,
    handleDelete,
    handleRefresh,
    handleTogglePlacement,
    persistLayout,
    getLayouts,
  } = board;

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
  );
};

export default HomeWidgetBoard;
