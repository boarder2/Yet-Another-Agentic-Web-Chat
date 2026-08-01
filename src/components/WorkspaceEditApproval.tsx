'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import ApprovalPanel, { ApprovalChip } from '@/components/ui/ApprovalPanel';
import { Textarea } from '@/components/ui/Textarea';
import { FileText, X, Check, CheckCheck, Ban, Bell } from 'lucide-react';

export type { PendingEditApproval } from '@/lib/streaming/chatState';

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
  onDecide: (
    approvalId: string,
    decision: 'accept' | 'accept_always' | 'reject' | 'always_prompt',
    freeformText?: string,
  ) => void;
  onDismiss?: () => void;
  queuePosition?: number;
  queueTotal?: number;
}) {
  // No countdown timer — with interrupt-based flow, runs persist until user responds.
  const [submitted, setSubmitted] = useState(false);
  const [rejectText, setRejectText] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

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
    <ApprovalPanel
      icon={FileText}
      title={actionLabel}
      chips={<ApprovalChip>{file}</ApprovalChip>}
      queuePosition={queuePosition}
      queueTotal={queueTotal}
      onDismiss={() => handleDecide('reject')}
      footer={
        <>
          {/* Reject */}
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
            <Button size="lg" icon={X} onClick={() => setShowRejectInput(true)}>
              Reject
            </Button>
          )}

          {/* Always prompt for this file — only when workspace auto-accept is on */}
          {workspaceAutoAccept && (
            <Button
              size="lg"
              icon={Bell}
              onClick={() => handleDecide('always_prompt')}
              title="Always ask before editing this file, even when the workspace is set to auto-accept"
            >
              Always prompt for this file
            </Button>
          )}

          {/* Accept once */}
          <Button
            variant="primary"
            size="lg"
            icon={Check}
            onClick={() => handleDecide('accept')}
          >
            Accept
          </Button>

          {/* Always accept this file */}
          <button
            type="button"
            onClick={() => handleDecide('accept_always')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
            title="Always accept edits to this file without prompting"
          >
            <CheckCheck size={14} />
            Always accept this file
          </button>
        </>
      }
    >
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
          <Textarea
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
            className="bg-surface-2/50 rounded-surface placeholder:text-fg/30 resize-none"
            rows={2}
          />
        </div>
      )}
    </ApprovalPanel>
  );
}
