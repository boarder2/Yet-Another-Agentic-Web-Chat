'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Ban, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';

/** Monospace identifier chip for an approval header (a file path, a tool name). */
export const ApprovalChip = ({ children }: { children: ReactNode }) => (
  <code className="text-xs bg-surface px-1.5 py-0.5 rounded-control text-fg border border-surface-2 truncate">
    {children}
  </code>
);

export type ApprovalRejection = {
  onSubmit: (reason?: string) => void;
  placeholder?: string;
};

const ApprovalPanel = ({
  icon: Icon,
  title,
  chips,
  queuePosition,
  queueTotal,
  onDismiss,
  dismissLabel = 'Dismiss',
  rejection,
  footer,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  chips?: ReactNode;
  queuePosition?: number;
  queueTotal?: number;
  onDismiss: () => void;
  dismissLabel?: string;
  rejection?: ApprovalRejection;
  footer: ReactNode;
  children: ReactNode;
}) => {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const rejectButtonRef = useRef<HTMLButtonElement>(null);

  const resetRejection = useCallback(() => {
    setRejecting(false);
    setReason('');
  }, []);

  const cancelRejection = useCallback(() => {
    resetRejection();
    requestAnimationFrame(() => rejectButtonRef.current?.focus());
  }, [resetRejection]);

  const submitRejection = useCallback(() => {
    const trimmedReason = reason.trim() || undefined;
    resetRejection();
    rejection?.onSubmit(trimmedReason);
  }, [reason, rejection, resetRejection]);

  const dismiss = useCallback(() => {
    resetRejection();
    onDismiss();
  }, [onDismiss, resetRejection]);

  return (
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
          <IconButton icon={X} label={dismissLabel} onClick={dismiss} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {children}
        {rejection && rejecting && (
          <div
            data-approval-rejection
            className="px-5 py-3 border-b border-surface-2"
          >
            <Textarea
              autoFocus
              aria-label="Rejection reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitRejection();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRejection();
                }
              }}
              placeholder={
                rejection.placeholder ??
                'Optional: tell the agent why you rejected this…'
              }
              className="resize-none"
              rows={2}
            />
          </div>
        )}
      </div>

      <div
        data-approval-footer
        className="shrink-0 flex flex-wrap gap-2 justify-end px-5 py-3 bg-surface border-t border-surface-2"
      >
        {rejection &&
          (rejecting ? (
            <>
              <Button size="lg" onClick={cancelRejection}>
                Cancel
              </Button>
              <Button
                variant="dangerSoft"
                size="lg"
                icon={Ban}
                onClick={submitRejection}
              >
                Send rejection
              </Button>
            </>
          ) : (
            <Button
              ref={rejectButtonRef}
              variant="dangerSoft"
              size="lg"
              icon={Ban}
              onClick={() => setRejecting(true)}
            >
              Reject
            </Button>
          ))}
        {footer}
      </div>
    </Card>
  );
};

export default ApprovalPanel;
