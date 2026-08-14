import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';

/** Monospace identifier chip for an approval header (a file path, a tool name). */
export const ApprovalChip = ({ children }: { children: React.ReactNode }) => (
  <code className="text-xs bg-surface px-1.5 py-0.5 rounded-control text-fg border border-surface-2 truncate">
    {children}
  </code>
);

const ApprovalPanel = ({
  icon: Icon,
  title,
  chips,
  queuePosition,
  queueTotal,
  onDismiss,
  dismissLabel = 'Dismiss',
  footer,
  children,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  chips?: React.ReactNode;
  queuePosition?: number;
  queueTotal?: number;
  onDismiss: () => void;
  dismissLabel?: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Card
    data-approval-panel
    radius="floating"
    className="mb-2 flex flex-col overflow-hidden shadow-raised max-h-[calc(100svh-16rem)]"
  >
    <div
      data-approval-header
      className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 bg-surface-2/70"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} className="text-accent shrink-0" />
        <span className="text-sm font-semibold text-fg">{title}</span>
        {chips}
        {queueTotal && queueTotal > 1 ? (
          <span className="shrink-0 text-xs font-medium text-fg-muted bg-surface-2 px-2 py-0.5 rounded-pill">
            {queuePosition} of {queueTotal}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-fg-subtle">Waiting on input</span>
        <IconButton icon={X} label={dismissLabel} onClick={onDismiss} />
      </div>
    </div>

    <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>

    <div
      data-approval-footer
      className="shrink-0 flex flex-wrap gap-2 justify-end px-5 py-3 bg-surface border-t border-surface-2"
    >
      {footer}
    </div>
  </Card>
);

export default ApprovalPanel;
