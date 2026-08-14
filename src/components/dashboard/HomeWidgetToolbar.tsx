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
import { IconButton } from '@/components/ui/IconButton';
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
      <IconButton
        icon={isEditMode ? Eye : Pencil}
        label={isEditMode ? 'Switch to View Mode' : 'Customize home widgets'}
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
            icon={ArrowDownToLine}
            label={
              settings.homeWidgetsPeek
                ? 'Widgets peek at the bottom of the screen — click to show in place'
                : 'Push widgets below the fold (only their tops peek up)'
            }
            tone={settings.homeWidgetsPeek ? 'active' : 'default'}
            aria-pressed={settings.homeWidgetsPeek}
            onClick={handleToggleHomePeek}
          />

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
    </div>
  );
};

export default HomeWidgetToolbar;
