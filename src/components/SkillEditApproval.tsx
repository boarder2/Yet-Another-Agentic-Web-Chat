'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookOpen, X, Check, Ban } from 'lucide-react';

export type PendingSkillEditApproval = {
  approvalId: string;
  toolCallId?: string;
  action: 'create' | 'update' | 'delete';
  name: string;
  oldDescription: string;
  newDescription: string;
  oldContent: string;
  newContent: string;
  scope: 'global' | 'workspace';
  workspaceId?: string | null;
  skillId?: string;
  createdAt?: number;
  status: 'pending' | 'accepted' | 'rejected';
};

type DiffLine =
  | { type: 'context'; text: string; lineNo: number }
  | { type: 'removed'; text: string; lineNo: number }
  | { type: 'added'; text: string; newLineNo: number };

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const lines: DiffLine[] = [];
  for (let i = 0; i < oldLines.length; i++) {
    lines.push({ type: 'removed', text: oldLines[i], lineNo: i + 1 });
  }
  for (let i = 0; i < newLines.length; i++) {
    lines.push({ type: 'added', text: newLines[i], newLineNo: i + 1 });
  }
  return lines;
}

function DiffView({
  oldString,
  newString,
}: {
  oldString: string;
  newString: string;
}) {
  const diff = computeDiff(oldString, newString);
  return (
    <div className="font-mono text-xs overflow-x-auto">
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

export function SkillEditApproval({
  approvalId,
  action,
  name,
  oldDescription,
  newDescription,
  oldContent,
  newContent,
  scope,
  createdAt,
  onDecide,
  onDismiss,
}: {
  approvalId: string;
  action: 'create' | 'update' | 'delete';
  name: string;
  oldDescription: string;
  newDescription: string;
  oldContent: string;
  newContent: string;
  scope: 'global' | 'workspace';
  createdAt?: number;
  onDecide: (
    approvalId: string,
    decision: 'accept' | 'reject',
    freeformText?: string,
  ) => void;
  onDismiss?: () => void;
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

  const handleDecide = useCallback(
    (decision: 'accept' | 'reject', text?: string) => {
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

  if (submitted) return null;

  const actionLabel =
    action === 'create'
      ? 'Create skill'
      : action === 'update'
        ? 'Update skill'
        : 'Delete skill';

  const showDiff =
    action !== 'delete' &&
    (oldContent !== newContent || oldDescription !== newDescription);

  return (
    <div className="mb-2 border border-surface-2 rounded-floating overflow-hidden bg-surface shadow-raised flex flex-col max-h-[calc(100svh-16rem)]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-surface-2/70">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-accent" />
          <span className="text-sm font-semibold text-fg">{actionLabel}</span>
          <code className="text-xs bg-surface px-1.5 py-0.5 rounded-control text-fg/80 border border-surface-2">
            {name}
          </code>
          <span className="text-xs text-fg/50 bg-surface-2 px-2 py-0.5 rounded-pill">
            {scope}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg/40 font-mono tabular-nums">
            {formatTime(remainingSeconds)}
          </span>
          <button
            type="button"
            onClick={() => handleDecide('reject')}
            className="p-1 rounded-control hover:bg-surface-2 transition-colors text-fg/50 hover:text-fg"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto flex-1 min-h-0">
        {action === 'delete' ? (
          <div className="px-5 py-4 text-sm text-fg/70 border-b border-surface-2">
            This will permanently delete the skill <strong>{name}</strong>.
          </div>
        ) : showDiff ? (
          <div className="border-b border-surface-2">
            {oldDescription !== newDescription && (
              <div className="px-5 py-2 border-b border-surface-2">
                <p className="text-xs text-fg/50 mb-1">Description</p>
                <DiffView
                  oldString={oldDescription}
                  newString={newDescription}
                />
              </div>
            )}
            {oldContent !== newContent && (
              <div>
                <p className="text-xs text-fg/50 px-5 pt-2">Content</p>
                <DiffView oldString={oldContent} newString={newContent} />
              </div>
            )}
          </div>
        ) : null}

        {showRejectInput && (
          <div className="px-5 py-3 border-b border-surface-2">
            <textarea
              autoFocus
              aria-label="Rejection reason"
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
        {showRejectInput ? (
          <button
            type="button"
            onClick={handleRejectSubmit}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-danger-soft text-danger hover:bg-danger-soft border border-danger transition-colors"
          >
            <Ban size={14} />
            Send rejection
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowRejectInput(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-surface-2 text-fg/70 hover:text-fg hover:bg-surface-2/80 transition-colors"
          >
            <X size={14} />
            Reject
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDecide('accept')}
          className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition-colors"
        >
          <Check size={14} />
          Accept
        </button>
      </div>
    </div>
  );
}
