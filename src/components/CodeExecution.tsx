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
  status: 'pending' | 'approved' | 'denied' | 'completed';
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

  const sendApproval = async (approved: boolean) => {
    setActionTaken(true);
    if (onActionTaken) onActionTaken(executionId, approved);
    try {
      await fetch('/api/sandbox/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId, approved }),
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
      <div className="flex gap-2 justify-end px-5 py-3 border-t border-surface-2 bg-surface">
        <button
          onClick={() => sendApproval(false)}
          className="px-5 py-2 text-sm font-medium rounded-surface bg-danger-soft text-danger hover:bg-danger-soft border border-danger transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => sendApproval(true)}
          className="px-5 py-2 text-sm font-medium rounded-surface bg-success-soft text-success hover:bg-success-soft border border-success transition-colors"
        >
          Run
        </button>
      </div>
    </div>
  );
}
