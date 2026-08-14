'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import ApprovalPanel, { ApprovalChip } from '@/components/ui/ApprovalPanel';
import { DiffTable, type DiffLine } from '@/components/ui/DiffTable';
import { FileText, Check, CheckCheck, Bell } from 'lucide-react';

export type { PendingEditApproval } from '@/lib/streaming/chatState';

// ---- Diff renderer ----

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
      rejection={{ onSubmit: (reason) => handleDecide('reject', reason) }}
      footer={
        <>
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
          <Button
            variant="ghost"
            size="lg"
            icon={CheckCheck}
            onClick={() => handleDecide('accept_always')}
            className="border-accent-border text-accent enabled:hover:bg-accent-soft enabled:hover:text-accent"
            title="Always accept edits to this file without prompting"
          >
            Always accept this file
          </Button>
        </>
      }
    >
      <div className="border-b border-surface-2">
        {action === 'edit' &&
        oldString !== undefined &&
        newString !== undefined ? (
          <DiffTable
            lines={computeDiff(
              oldString,
              newString,
              occurrences ?? 1,
              replaceAll ?? false,
            )}
            banner={
              replaceAll && occurrences && occurrences > 1
                ? `Showing 1 of ${occurrences} replacements`
                : undefined
            }
          />
        ) : action === 'create' && content !== undefined ? (
          <DiffTable
            lines={content.split('\n').map((line, idx) => ({
              type: 'added' as const,
              text: line,
              newLineNo: idx + 1,
            }))}
          />
        ) : null}
      </div>
    </ApprovalPanel>
  );
}
