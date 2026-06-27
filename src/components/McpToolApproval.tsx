'use client';

import { useState, useCallback, useRef } from 'react';
import { Plug, X, Check, Ban, ShieldCheck } from 'lucide-react';

export type PendingMcpApproval = {
  approvalId: string;
  toolCallId?: string;
  serverId?: string;
  serverName: string;
  toolName: string;
  namespacedName: string;
  description: string;
  arguments: Record<string, unknown>;
  createdAt?: number;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
};

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
    <div className="mb-2 border border-surface-2 rounded-floating overflow-hidden bg-surface shadow-raised flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-surface-2/70">
        <div className="flex items-center gap-2">
          <Plug size={16} className="text-accent" />
          <span className="text-sm font-semibold text-fg">Run MCP tool</span>
          <code className="text-xs bg-surface px-1.5 py-0.5 rounded-control text-fg/80 border border-surface-2">
            {serverName}
          </code>
          <code className="text-xs bg-surface px-1.5 py-0.5 rounded-control text-fg/80 border border-surface-2">
            {toolName}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg/40">Waiting on input</span>
          <button
            type="button"
            onClick={() => handleDecide(false)}
            className="p-1 rounded-control hover:bg-surface-2 transition-colors duration-150 text-fg/50 hover:text-fg"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      {(description || hasArgs) && (
        <div className="px-5 py-3 border-t border-surface-2 space-y-2">
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

      {/* Actions */}
      <div className="flex flex-wrap gap-2 justify-end px-5 py-3 bg-surface border-t border-surface-2">
        <button
          type="button"
          onClick={() => handleDecide(false)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-surface-2 text-fg/70 hover:text-fg hover:bg-surface-2/80 transition-colors duration-150"
        >
          <Ban size={14} />
          Decline
        </button>
        {serverId && (
          <button
            type="button"
            onClick={() => handleDecide(true, { alwaysAllow: true })}
            title="Approve and auto-run this tool from now on (set in Settings → MCP Servers)"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-surface-2 text-fg/70 hover:text-fg hover:bg-surface-2/80 transition-colors duration-150"
          >
            <ShieldCheck size={14} />
            Always allow
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDecide(true)}
          className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition-colors duration-150"
        >
          <Check size={14} />
          Approve
        </button>
      </div>
    </div>
  );
}
