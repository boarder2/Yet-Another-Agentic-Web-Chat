'use client';

import { useState } from 'react';
import { CodeBlock } from './CodeBlock';
import {
  CodeExecutionWarning,
  hasAcceptedWarning,
  acceptWarning,
} from './CodeExecutionWarning';
import { Terminal, X } from 'lucide-react';

export type PendingExecution = {
  executionId: string;
  code: string;
  description?: string;
  toolCallId?: string;
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'cancelled';
  result?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    timedOut?: boolean;
    oomKilled?: boolean;
    denied?: boolean;
  };
};

export function CodeExecutionApproval({
  executionId,
  code,
  description,
  onDismiss,
  onActionTaken,
  queuePosition,
  queueTotal,
}: {
  executionId: string;
  code: string;
  description?: string;
  onDismiss?: () => void;
  onActionTaken?: (executionId: string, approved: boolean) => void;
  queuePosition?: number;
  queueTotal?: number;
}) {
  const [warningAccepted, setWarningAccepted] = useState(() =>
    hasAcceptedWarning(),
  );
  const [actionTaken, setActionTaken] = useState(false);
  const [denying, setDenying] = useState(false);
  const [denyReason, setDenyReason] = useState('');

  const sendApproval = async (approved: boolean, reason?: string) => {
    setActionTaken(true);
    if (onActionTaken) onActionTaken(executionId, approved);
    try {
      await fetch('/api/chat/runs/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId: executionId,
          response: { approved, reason },
        }),
      });
    } catch (err) {
      console.error('Failed to send approval:', err);
    }
    if (!approved && onDismiss) onDismiss();
  };

  if (actionTaken) return null;

  if (!warningAccepted) {
    return (
      <div className="mb-2">
        <CodeBlock className="language-javascript">{code}</CodeBlock>
        <CodeExecutionWarning
          onAccept={() => {
            acceptWarning();
            setWarningAccepted(true);
          }}
          onDecline={() => {
            sendApproval(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mb-2 border border-surface-2 rounded-floating overflow-hidden bg-surface shadow-raised">
      <div className="flex items-center justify-between px-5 py-3 bg-surface-2/70">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-accent" />
          <span className="text-sm font-semibold text-fg">
            Code Execution Request
          </span>
          {queueTotal && queueTotal > 1 && (
            <span className="text-xs font-medium text-fg/60 bg-surface-2 px-2 py-0.5 rounded-pill">
              {queuePosition} of {queueTotal}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => sendApproval(false)}
          className="p-1 rounded-control hover:bg-surface-2 transition-colors text-fg/50 hover:text-fg"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      {description && (
        <div className="px-5 py-2 text-sm text-fg/70 border-b border-surface-2 bg-surface-2/30">
          {description}
        </div>
      )}
      <div className="max-h-[75vh] overflow-y-auto">
        <CodeBlock className="language-javascript">{code}</CodeBlock>
      </div>
      {denying && (
        <div className="px-5 py-3 border-t border-surface-2 bg-surface-2/30">
          <label className="block text-xs font-medium text-fg/70 mb-1.5">
            Tell the assistant what to do differently (optional)
          </label>
          <textarea
            autoFocus
            aria-label="Reason for denial"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendApproval(false, denyReason.trim() || undefined);
              }
            }}
            placeholder="e.g. don't fetch from the network; use a smaller input; try a different approach..."
            className="w-full bg-surface border border-surface-2 rounded-surface px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:border-accent resize-none"
            rows={3}
          />
        </div>
      )}
      <div className="flex gap-2 justify-end px-5 py-3 border-t border-surface-2 bg-surface">
        {denying ? (
          <>
            <button
              type="button"
              onClick={() => {
                setDenying(false);
                setDenyReason('');
              }}
              className="px-5 py-2 text-sm font-medium rounded-surface bg-surface-2 text-fg/70 hover:text-fg hover:bg-surface-2/80 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                sendApproval(false, denyReason.trim() || undefined)
              }
              className="px-5 py-2 text-sm font-medium rounded-surface bg-danger-soft text-danger hover:bg-danger-soft border border-danger transition-colors"
            >
              Deny
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setDenying(true)}
              className="px-5 py-2 text-sm font-medium rounded-surface bg-danger-soft text-danger hover:bg-danger-soft border border-danger transition-colors"
            >
              Deny
            </button>
            <button
              type="button"
              onClick={() => sendApproval(true)}
              className="px-5 py-2 text-sm font-medium rounded-surface bg-success-soft text-success hover:bg-success-soft border border-success transition-colors"
            >
              Run
            </button>
          </>
        )}
      </div>
    </div>
  );
}
