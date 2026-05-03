'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, X, Check, CheckCheck, Ban, Bell } from 'lucide-react';

export type PendingEditApproval = {
  approvalId: string;
  toolCallId?: string;
  action: 'edit' | 'create';
  workspaceId: string;
  fileId?: string;
  file: string;
  oldString?: string;
  newString?: string;
  content?: string;
  replaceAll?: boolean;
  occurrences?: number;
  workspaceAutoAccept: boolean;
  fileAutoAccept: number | null;
  createdAt?: number;
  status: 'pending' | 'accepted' | 'rejected';
};

// ---- Diff renderer ----

type DiffLine =
  | { type: 'context'; text: string; lineNo: number }
  | { type: 'removed'; text: string; lineNo: number }
  | { type: 'added'; text: string; newLineNo: number };

function computeDiff(
  oldStr: string,
  newStr: string,
  occurrences: number,
  replaceAll: boolean,
): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const lines: DiffLine[] = [];

  // For a snippet diff we show removed then added, no context
  for (let i = 0; i < oldLines.length; i++) {
    lines.push({ type: 'removed', text: oldLines[i], lineNo: i + 1 });
  }
  for (let i = 0; i < newLines.length; i++) {
    lines.push({ type: 'added', text: newLines[i], newLineNo: i + 1 });
  }

  if (replaceAll && occurrences && occurrences > 1) {
    // Just show the single-occurrence diff with a note; don't repeat N times
  }

  return lines;
}

function DiffView({
  oldString,
  newString,
  replaceAll,
  occurrences,
}: {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  occurrences?: number;
}) {
  const diff = computeDiff(
    oldString,
    newString,
    occurrences ?? 1,
    replaceAll ?? false,
  );

  return (
    <div className="font-mono text-xs overflow-x-auto">
      {replaceAll && occurrences && occurrences > 1 && (
        <div className="px-3 py-1 text-fg/50 bg-surface-2/30 border-b border-surface-2 italic">
          Showing 1 of {occurrences} replacements
        </div>
      )}
      <table className="w-full border-collapse">
        <tbody>
          {diff.map((line, idx) => (
            <tr
              key={idx}
              className={
                line.type === 'removed'
                  ? 'bg-danger-soft'
                  : line.type === 'added'
                    ? 'bg-success-soft'
                    : ''
              }
            >
              <td className="select-none w-10 px-2 py-0.5 text-right text-fg/30 border-r border-surface-2 align-top">
                {line.type === 'removed'
                  ? line.lineNo
                  : line.type === 'added'
                    ? line.newLineNo
                    : line.lineNo}
              </td>
              <td className="px-2 py-0.5 whitespace-pre-wrap break-all">
                <span
                  className={
                    line.type === 'removed'
                      ? 'text-danger'
                      : line.type === 'added'
                        ? 'text-success'
                        : 'text-fg/70'
                  }
                >
                  {line.type === 'removed'
                    ? '−'
                    : line.type === 'added'
                      ? '+'
                      : ' '}
                </span>{' '}
                <span className="text-fg">{line.text}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContentPreview({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="font-mono text-xs overflow-x-auto">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} className="bg-success-soft">
              <td className="select-none w-10 px-2 py-0.5 text-right text-fg/30 border-r border-surface-2 align-top">
                {idx + 1}
              </td>
              <td className="px-2 py-0.5 whitespace-pre-wrap break-all text-fg">
                {line}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Main component ----

export function WorkspaceEditApproval({
  approvalId,
  action,
  file,
  oldString,
  newString,
  content,
  replaceAll,
  occurrences,
  workspaceAutoAccept,
  createdAt,
  onDecide,
  onDismiss,
  queuePosition,
  queueTotal,
}: {
  approvalId: string;
  action: 'edit' | 'create';
  file: string;
  oldString?: string;
  newString?: string;
  content?: string;
  replaceAll?: boolean;
  occurrences?: number;
  workspaceAutoAccept: boolean;
  createdAt?: number;
  onDecide: (
    approvalId: string,
    decision: 'accept' | 'accept_always' | 'reject' | 'always_prompt',
    freeformText?: string,
  ) => void;
  onDismiss?: () => void;
  queuePosition?: number;
  queueTotal?: number;
}) {
  const TIMEOUT_MS = 15 * 60 * 1000;
  const [remainingSeconds, setRemainingSeconds] = useState(() => {
    if (createdAt) {
      const elapsed = Date.now() - createdAt;
      return Math.max(0, Math.floor((TIMEOUT_MS - elapsed) / 1000));
    }
    return 15 * 60;
  });
  const [submitted, setSubmitted] = useState(false);
  const [rejectText, setRejectText] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  useEffect(() => {
    if (submitted) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleDecide('reject');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleDecide = useCallback(
    (
      decision: 'accept' | 'accept_always' | 'reject' | 'always_prompt',
      text?: string,
    ) => {
      if (submitted) return;
      setSubmitted(true);
      onDecide(approvalId, decision, text);
      onDismiss?.();
    },
    [submitted, approvalId, onDecide, onDismiss],
  );

  const handleRejectSubmit = useCallback(() => {
    handleDecide('reject', rejectText.trim() || undefined);
  }, [handleDecide, rejectText]);

  if (submitted) return null;

  const actionLabel = action === 'create' ? 'Create file' : 'Edit file';

  return (
    <div className="mb-2 border border-surface-2 rounded-floating overflow-hidden bg-surface shadow-raised flex flex-col max-h-[calc(100svh-16rem)]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-surface-2/70">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-accent" />
          <span className="text-sm font-semibold text-fg">{actionLabel}</span>
          <code className="text-xs bg-surface px-1.5 py-0.5 rounded-control text-fg/80 border border-surface-2">
            {file}
          </code>
          {queueTotal && queueTotal > 1 && (
            <span className="text-xs font-medium text-fg/60 bg-surface-2 px-2 py-0.5 rounded-pill">
              {queuePosition} of {queueTotal}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg/40 font-mono tabular-nums">
            {formatTime(remainingSeconds)}
          </span>
          <button
            onClick={() => handleDecide('reject')}
            className="p-1 rounded-control hover:bg-surface-2 transition-colors text-fg/50 hover:text-fg"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="overflow-y-auto flex-1 min-h-0">
        <div className="border-b border-surface-2">
          {action === 'edit' &&
          oldString !== undefined &&
          newString !== undefined ? (
            <DiffView
              oldString={oldString}
              newString={newString}
              replaceAll={replaceAll}
              occurrences={occurrences}
            />
          ) : action === 'create' && content !== undefined ? (
            <ContentPreview content={content} />
          ) : null}
        </div>

        {/* Reject freeform input */}
        {showRejectInput && (
          <div className="px-5 py-3 border-b border-surface-2">
            <textarea
              autoFocus
              value={rejectText}
              onChange={(e) => setRejectText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRejectSubmit();
                }
                if (e.key === 'Escape') setShowRejectInput(false);
              }}
              placeholder="Optional: tell the agent why you rejected this…"
              className="w-full bg-surface-2/50 border border-surface-2 rounded-surface px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:border-accent resize-none"
              rows={2}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex flex-wrap gap-2 justify-end px-5 py-3 bg-surface border-t border-surface-2">
        {/* Reject */}
        {showRejectInput ? (
          <button
            onClick={handleRejectSubmit}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-danger-soft text-danger hover:bg-danger-soft border border-danger transition-colors"
          >
            <Ban size={14} />
            Send rejection
          </button>
        ) : (
          <button
            onClick={() => setShowRejectInput(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-surface-2 text-fg/70 hover:text-fg hover:bg-surface-2/80 transition-colors"
          >
            <X size={14} />
            Reject
          </button>
        )}

        {/* Always prompt for this file — only when workspace auto-accept is on */}
        {workspaceAutoAccept && (
          <button
            onClick={() => handleDecide('always_prompt')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-surface-2 text-fg/70 hover:text-fg hover:bg-surface-2/80 transition-colors"
            title="Always ask before editing this file, even when the workspace is set to auto-accept"
          >
            <Bell size={14} />
            Always prompt for this file
          </button>
        )}

        {/* Accept once */}
        <button
          onClick={() => handleDecide('accept')}
          className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition-colors"
        >
          <Check size={14} />
          Accept
        </button>

        {/* Always accept this file */}
        <button
          onClick={() => handleDecide('accept_always')}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
          title="Always accept edits to this file without prompting"
        >
          <CheckCheck size={14} />
          Always accept this file
        </button>
      </div>
    </div>
  );
}
