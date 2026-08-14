'use client';

import {
  RefreshCw,
  Edit,
  Trash2,
  AlertCircle,
  GripVertical,
  Code2,
  Home,
  LayoutDashboard,
} from 'lucide-react';
import { Description } from '@headlessui/react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import Modal from '@/components/ui/Modal';
import { Widget } from '@/lib/types/widget';
import { useConfig } from '@/lib/hooks/api/useConfig';
import WidgetContent from './WidgetContent';
import { ListEmptyState, ListLoading } from '@/components/ui/List';

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

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Surfaces this widget currently appears on — surfaced in the delete
  // confirmation so users understand a delete removes it everywhere, not just
  // from the page they're looking at (placement toggles handle per-page hiding).
  const surfaces: string[] = [];
  if (widget.showOnHome) surfaces.push('the home page');
  if (widget.showOnDashboard !== false) surfaces.push('the dashboard');
  const surfacesText =
    surfaces.length === 2
      ? `${surfaces[0]} and ${surfaces[1]}`
      : surfaces[0] || 'this page';

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
        isEditMode ? '' : 'border-0 bg-transparent rounded-none'
      }`}
    >
      {isEditMode && (
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 flex-1 min-w-0">
              {/* Drag Handle */}
              <div
                className="widget-drag-handle shrink-0 p-1 rounded-control hover:bg-surface-2 cursor-move transition-colors duration-150"
                title="Drag to move widget"
              >
                <GripVertical size={16} className="text-fg-subtle" />
              </div>

              <CardTitle className="truncate">{widget.title}</CardTitle>
              {isCode && (
                <span
                  className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-control bg-surface-2 text-fg-subtle text-[10px]"
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
                className="text-xs text-fg-subtle"
                title={getRefreshFrequencyText()}
              >
                {formatLastUpdated(widget.lastUpdated)}
              </span>

              {/* Refresh button */}
              <IconButton
                icon={RefreshCw}
                label={
                  inert
                    ? 'Code execution is disabled — cannot refresh'
                    : 'Refresh Widget'
                }
                loading={widget.isLoading}
                disabled={inert}
                onClick={() => onRefresh(widget.id)}
              />

              {/* Placement toggles — which surface(s) the widget appears on */}
              {onTogglePlacement && (
                <>
                  <IconButton
                    icon={Home}
                    label={
                      widget.showOnHome
                        ? 'Showing on home — click to hide'
                        : 'Show on home page'
                    }
                    tone={widget.showOnHome ? 'active' : 'default'}
                    aria-pressed={widget.showOnHome}
                    onClick={() => onTogglePlacement(widget, 'home')}
                  />
                  <IconButton
                    icon={LayoutDashboard}
                    label={
                      widget.showOnDashboard !== false
                        ? 'Showing on dashboard — click to hide'
                        : 'Show on dashboard'
                    }
                    tone={
                      widget.showOnDashboard !== false ? 'active' : 'default'
                    }
                    aria-pressed={widget.showOnDashboard !== false}
                    onClick={() => onTogglePlacement(widget, 'dashboard')}
                  />
                </>
              )}

              {/* Edit */}
              <IconButton
                icon={Edit}
                label="Edit Widget"
                onClick={() => onEdit(widget)}
              />

              {/* Convert AI → Code */}
              {!isCode && ceEnabled && onConvert && (
                <IconButton
                  icon={Code2}
                  label="Convert to Code Widget"
                  onClick={() => onConvert(widget)}
                />
              )}

              {/* Delete */}
              <IconButton
                icon={Trash2}
                label="Delete Widget"
                tone="danger"
                onClick={() => setConfirmDeleteOpen(true)}
              />
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent
        className={`flex-1 overflow-hidden ${isEditMode ? '' : 'p-0'}`}
      >
        <div className="h-full overflow-y-auto">
          {widget.isLoading ? (
            <ListLoading
              layout="compact"
              size={20}
              status="Loading content..."
            />
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
                <p className="mt-3 text-xs text-fg-muted italic">
                  Code execution disabled — showing last result from{' '}
                  {formatLastUpdated(widget.lastUpdated)}.
                </p>
              )}
            </>
          ) : inert ? (
            <ListEmptyState
              layout="compact"
              body="Code execution is disabled — this widget cannot run."
            />
          ) : (
            <ListEmptyState
              layout="compact"
              title="No content yet"
              body="Click refresh to load content"
            />
          )}
        </div>
      </CardContent>

      <Modal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        size="sm"
        title="Delete widget"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDeleteOpen(false);
                onDelete(widget.id);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <Description className="text-sm text-fg-muted">
          Permanently delete{' '}
          <span className="font-medium text-fg">{widget.title}</span>? It
          currently appears on {surfacesText}, and deleting removes it
          everywhere — this cannot be undone. To hide it from a single page
          instead, use the home/dashboard toggles.
        </Description>
      </Modal>
    </Card>
  );
};

export default WidgetDisplay;
