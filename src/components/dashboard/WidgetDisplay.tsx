'use client';

import {
  RefreshCw,
  LoaderCircle,
  Edit,
  Trash2,
  AlertCircle,
  GripVertical,
  Code2,
  Home,
  LayoutDashboard,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Widget } from '@/lib/types/widget';
import { useConfig } from '@/lib/hooks/api/useConfig';
import WidgetContent from './WidgetContent';

interface WidgetDisplayProps {
  widget: Widget;
  onEdit: (widget: Widget) => void;
  onDelete: (widgetId: string) => void;
  onRefresh: (widgetId: string) => void;
  onConvert?: (widget: Widget) => void;
  /** Toggle which surface (home/dashboard) the widget appears on. */
  onTogglePlacement?: (widget: Widget, key: 'home' | 'dashboard') => void;
  /** Edit mode shows the header, footer, and actions; normal mode shows only content. */
  isEditMode?: boolean;
}

const WidgetDisplay = ({
  widget,
  onEdit,
  onDelete,
  onRefresh,
  onConvert,
  onTogglePlacement,
  isEditMode = false,
}: WidgetDisplayProps) => {
  const { data: appConfig } = useConfig();
  const ceEnabled = !!(
    appConfig?.codeExecution as { enabled?: boolean } | undefined
  )?.enabled;
  const isCode = widget.widgetType === 'code';
  const inert = isCode && !ceEnabled;

  const formatLastUpdated = (date: Date | null) => {
    if (!date) return 'Never';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getRefreshFrequencyText = () => {
    return `Every ${widget.refreshFrequency} ${widget.refreshUnit}`;
  };

  return (
    <Card
      className={`flex flex-col h-full w-full ${
        isEditMode ? '' : 'border-0 bg-transparent shadow-none rounded-none'
      }`}
    >
      {isEditMode && (
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 flex-1 min-w-0">
              {/* Drag Handle */}
              <div
                className="widget-drag-handle shrink-0 p-1 rounded-control hover:bg-surface-2 cursor-move transition-colors"
                title="Drag to move widget"
              >
                <GripVertical size={16} className="text-fg/50" />
              </div>

              <CardTitle className="text-lg font-medium truncate">
                {widget.title}
              </CardTitle>
              {isCode && (
                <span
                  className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-control bg-surface-2 text-fg/60 text-[10px]"
                  title="Code widget"
                >
                  <Code2 size={11} />
                  JS
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              {/* Last updated date with refresh frequency tooltip */}
              <span
                className="text-xs text-fg/60"
                title={getRefreshFrequencyText()}
              >
                {formatLastUpdated(widget.lastUpdated)}
              </span>

              {/* Refresh button */}
              <button
                type="button"
                onClick={() => onRefresh(widget.id)}
                disabled={widget.isLoading || inert}
                className="p-1.5 hover:bg-surface-2 rounded-control transition-colors disabled:opacity-50"
                title={
                  inert
                    ? 'Code execution is disabled — cannot refresh'
                    : 'Refresh Widget'
                }
              >
                {widget.isLoading ? (
                  <LoaderCircle
                    size={16}
                    className="animate-spin text-accent"
                  />
                ) : (
                  <RefreshCw size={16} className="text-fg/70" />
                )}
              </button>

              {/* Placement toggles — which surface(s) the widget appears on */}
              {onTogglePlacement && (
                <>
                  <button
                    type="button"
                    onClick={() => onTogglePlacement(widget, 'home')}
                    className={`p-1.5 rounded-control transition-colors ${
                      widget.showOnHome
                        ? 'bg-accent text-accent-fg hover:bg-accent-700'
                        : 'hover:bg-surface-2 text-fg/70'
                    }`}
                    title={
                      widget.showOnHome
                        ? 'Showing on home — click to hide'
                        : 'Show on home page'
                    }
                  >
                    <Home size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onTogglePlacement(widget, 'dashboard')}
                    className={`p-1.5 rounded-control transition-colors ${
                      widget.showOnDashboard !== false
                        ? 'bg-accent text-accent-fg hover:bg-accent-700'
                        : 'hover:bg-surface-2 text-fg/70'
                    }`}
                    title={
                      widget.showOnDashboard !== false
                        ? 'Showing on dashboard — click to hide'
                        : 'Show on dashboard'
                    }
                  >
                    <LayoutDashboard size={16} />
                  </button>
                </>
              )}

              {/* Edit */}
              <button
                type="button"
                onClick={() => onEdit(widget)}
                className="p-1.5 hover:bg-surface-2 rounded-control transition-colors"
                title="Edit Widget"
              >
                <Edit size={16} className="text-fg/70" />
              </button>

              {/* Convert AI → Code */}
              {!isCode && ceEnabled && onConvert && (
                <button
                  type="button"
                  onClick={() => onConvert(widget)}
                  className="p-1.5 hover:bg-surface-2 rounded-control transition-colors"
                  title="Convert to Code Widget"
                >
                  <Code2 size={16} className="text-fg/70" />
                </button>
              )}

              {/* Delete */}
              <button
                type="button"
                onClick={() => onDelete(widget.id)}
                className="p-1.5 hover:bg-surface-2 rounded-control transition-colors"
                title="Delete Widget"
              >
                <Trash2 size={16} className="text-danger" />
              </button>
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent
        className={`flex-1 overflow-hidden ${isEditMode ? '' : 'p-0'}`}
      >
        <div className="h-full overflow-y-auto">
          {widget.isLoading ? (
            <div className="flex items-center justify-center py-8 text-fg/60">
              <LoaderCircle
                size={20}
                className="animate-spin mr-2 text-accent"
              />
              <span>Loading content...</span>
            </div>
          ) : widget.error ? (
            <div className="flex items-start space-x-2 p-3 bg-danger-soft rounded-control border border-danger">
              <AlertCircle size={16} className="text-danger mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-danger">
                  Error Loading Content
                </p>
                <p className="text-xs text-danger mt-1">{widget.error}</p>
              </div>
            </div>
          ) : widget.content ? (
            <>
              <WidgetContent
                content={widget.content}
                charts={widget.charts}
                className="max-w-none"
              />
              {inert && (
                <p className="mt-3 text-xs text-fg/50 italic">
                  Code execution disabled — showing last result from{' '}
                  {formatLastUpdated(widget.lastUpdated)}.
                </p>
              )}
            </>
          ) : inert ? (
            <div className="flex items-center justify-center py-8 text-fg/60 text-center text-sm">
              Code execution is disabled — this widget cannot run.
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-fg/60">
              <div className="text-center">
                <p className="text-sm">No content yet</p>
                <p className="text-xs mt-1">Click refresh to load content</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default WidgetDisplay;
