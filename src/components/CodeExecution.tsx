'use client';

import { useState } from 'react';
import { CodeBlock } from './CodeBlock';
import { Button } from '@/components/ui/Button';
import ApprovalPanel from '@/components/ui/ApprovalPanel';
import { Textarea } from '@/components/ui/Textarea';
import {
  CodeExecutionWarning,
  hasAcceptedWarning,
  acceptWarning,
} from './CodeExecutionWarning';
import { Terminal } from 'lucide-react';

export type { PendingExecution } from '@/lib/streaming/chatState';

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
    <ApprovalPanel
      icon={Terminal}
      title="Code Execution Request"
      queuePosition={queuePosition}
      queueTotal={queueTotal}
      onDismiss={() => sendApproval(false)}
      footer={
        denying ? (
          <>
            <Button
              size="lg"
              onClick={() => {
                setDenying(false);
                setDenyReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="dangerSoft"
              size="lg"
              onClick={() =>
                sendApproval(false, denyReason.trim() || undefined)
              }
            >
              Deny
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="dangerSoft"
              size="lg"
              onClick={() => setDenying(true)}
            >
              Deny
            </Button>
            <Button
              variant="successSoft"
              size="lg"
              onClick={() => sendApproval(true)}
            >
              Run
            </Button>
          </>
        )
      }
    >
      {description && (
        <div className="px-5 py-2 text-sm text-fg-muted border-b border-surface-2 bg-surface-2/30">
          {description}
        </div>
      )}
      <CodeBlock className="language-javascript">{code}</CodeBlock>
      {denying && (
        <div className="px-5 py-3 border-t border-surface-2 bg-surface-2/30">
          <label className="block text-xs font-medium text-fg-muted mb-1.5">
            Tell the assistant what to do differently (optional)
          </label>
          <Textarea
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
            rows={3}
          />
        </div>
      )}
    </ApprovalPanel>
  );
}
