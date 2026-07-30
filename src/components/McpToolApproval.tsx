'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import ApprovalPanel, { ApprovalChip } from '@/components/ui/ApprovalPanel';
import { Plug, Check, Ban, ShieldCheck } from 'lucide-react';

export type { PendingMcpApproval } from '@/lib/streaming/chatState';

export function McpToolApproval({
  approvalId,
  serverId,
  serverName,
  toolName,
  description,
  arguments: args,
  onDecide,
  onDismiss,
}: {
  approvalId: string;
  serverId?: string;
  serverName: string;
  toolName: string;
  description: string;
  arguments: Record<string, unknown>;
  onDecide: (
    approvalId: string,
    approved: boolean,
    opts?: { alwaysAllow?: boolean },
  ) => void;
  onDismiss?: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  // Synchronous guard: blocks a second fire from a rapid double-click before the
  // `submitted` state update re-renders.
  const submittedRef = useRef(false);

  const handleDecide = useCallback(
    (approved: boolean, opts?: { alwaysAllow?: boolean }) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitted(true);
      onDecide(approvalId, approved, opts);
      onDismiss?.();
    },
    [approvalId, onDecide, onDismiss],
  );

  if (submitted) return null;

  const hasArgs = Object.keys(args).length > 0;

  return (
    <ApprovalPanel
      icon={Plug}
      title="Run MCP tool"
      chips={
        <>
          <ApprovalChip>{serverName}</ApprovalChip>
          <ApprovalChip>{toolName}</ApprovalChip>
        </>
      }
      onDismiss={() => handleDecide(false)}
      footer={
        <>
          <Button size="lg" icon={Ban} onClick={() => handleDecide(false)}>
            Decline
          </Button>
          {serverId && (
            <Button
              size="lg"
              icon={ShieldCheck}
              onClick={() => handleDecide(true, { alwaysAllow: true })}
              title="Approve and auto-run this tool from now on (set in Settings → MCP Servers)"
            >
              Always allow
            </Button>
          )}
          <Button
            variant="primary"
            size="lg"
            icon={Check}
            onClick={() => handleDecide(true)}
          >
            Approve
          </Button>
        </>
      }
    >
      {(description || hasArgs) && (
        <div className="px-5 py-3 space-y-2">
          {description && (
            <p className="text-xs text-fg/60 line-clamp-3" title={description}>
              {description}
            </p>
          )}
          {hasArgs && (
            <div>
              <p className="text-xs text-fg/50 mb-1">Arguments</p>
              <pre className="text-xs bg-surface-2/50 border border-surface-2 rounded-surface px-3 py-2 overflow-x-auto text-fg/80 whitespace-pre-wrap break-all">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </ApprovalPanel>
  );
}
