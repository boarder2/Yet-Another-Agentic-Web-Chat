'use client';

import {
  Plus,
  RefreshCw,
  Download,
  Upload,
  Layers,
  List,
  Pencil,
  Eye,
  ArrowDownToLine,
} from 'lucide-react';
import type { WidgetBoard } from '@/lib/hooks/useWidgetBoard';

/**
 * Home-page widget management controls (edit/refresh/add). Rendered separately
 * from <HomeWidgetBoard /> so it can be anchored to the top of the page rather
 * than crowding the top of the widget grid.
 */
const HomeWidgetToolbar = ({ board }: { board: WidgetBoard }) => {
  const {
    isEditMode,
    setIsEditMode,
    settings,
    handleAddWidget,
    handleRefreshAll,
    handleExport,
    handleImport,
    handleToggleProcessingMode,
    handleToggleHomePeek,
  } = board;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setIsEditMode((v) => !v)}
        className={`p-2 rounded-surface transition duration-200 ${
          isEditMode
            ? 'bg-accent text-accent-fg hover:bg-accent-700'
            : 'text-fg/60 hover:text-fg hover:bg-surface-2'
        }`}
        title={isEditMode ? 'Switch to View Mode' : 'Customize home widgets'}
      >
        {isEditMode ? <Eye size={18} /> : <Pencil size={18} />}
      </button>

      <button
        type="button"
        onClick={handleRefreshAll}
        className="p-2 text-fg/60 hover:text-fg hover:bg-surface-2 rounded-surface transition duration-200"
        title="Refresh All Widgets"
      >
        <RefreshCw size={18} />
      </button>

      {isEditMode && (
        <>
          <button
            type="button"
            onClick={handleToggleHomePeek}
            className={`p-2 rounded-surface transition duration-200 ${
              settings.homeWidgetsPeek
                ? 'bg-accent text-accent-fg hover:bg-accent-700'
                : 'text-fg/60 hover:text-fg hover:bg-surface-2'
            }`}
            title={
              settings.homeWidgetsPeek
                ? 'Widgets peek at the bottom of the screen — click to show in place'
                : 'Push widgets below the fold (only their tops peek up)'
            }
          >
            <ArrowDownToLine size={18} />
          </button>

          <button
            type="button"
            onClick={handleToggleProcessingMode}
            className="p-2 text-fg/60 hover:text-fg hover:bg-surface-2 rounded-surface transition duration-200"
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
            className="p-2 text-fg/60 hover:text-fg hover:bg-surface-2 rounded-surface transition duration-200"
            title="Export Dashboard Configuration"
          >
            <Download size={18} />
          </button>

          <button
            type="button"
            onClick={handleImport}
            className="p-2 text-fg/60 hover:text-fg hover:bg-surface-2 rounded-surface transition duration-200"
            title="Import Dashboard Configuration"
          >
            <Upload size={18} />
          </button>

          <button
            type="button"
            onClick={handleAddWidget}
            className="p-2 bg-accent text-accent-fg hover:bg-accent-700 rounded-surface transition duration-200"
            title="Add New Widget"
          >
            <Plus size={18} />
          </button>
        </>
      )}
    </div>
  );
};

export default HomeWidgetToolbar;
