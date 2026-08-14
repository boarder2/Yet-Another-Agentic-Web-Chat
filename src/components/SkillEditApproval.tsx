'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import ApprovalPanel, { ApprovalChip } from '@/components/ui/ApprovalPanel';
import { DiffTable, type DiffLine } from '@/components/ui/DiffTable';
import { BookOpen, Check } from 'lucide-react';

export type { PendingSkillEditApproval } from '@/lib/streaming/chatState';

// Cap the LCS table size; beyond this we fall back to a plain
// all-removed/all-added rendering rather than risk a huge O(n*m) allocation.
const MAX_DIFF_CELLS = 4_000_000;

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  const n = a.length;
  const m = b.length;
  const lines: DiffLine[] = [];

  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) {
    for (let i = 0; i < n; i++)
      lines.push({ type: 'removed', text: a[i], lineNo: i + 1 });
    for (let j = 0; j < m; j++)
      lines.push({ type: 'added', text: b[j], newLineNo: j + 1 });
    return lines;
  }

  // Longest-common-subsequence table over lines, then backtrack to emit
  // context / removed / added rows.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'context', text: a[i], lineNo: i + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'removed', text: a[i], lineNo: i + 1 });
      i++;
    } else {
      lines.push({ type: 'added', text: b[j], newLineNo: j + 1 });
      j++;
    }
  }
  while (i < n) lines.push({ type: 'removed', text: a[i], lineNo: i++ + 1 });
  while (j < m) lines.push({ type: 'added', text: b[j], newLineNo: j++ + 1 });
  return lines;
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
  newScope,
  oldDisableModelInvocation,
  disableModelInvocation,
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
  newScope?: 'global' | 'workspace';
  oldDisableModelInvocation?: boolean;
  disableModelInvocation?: boolean;
  onDecide: (
    approvalId: string,
    decision: 'accept' | 'reject',
    freeformText?: string,
  ) => void;
  onDismiss?: () => void;
}) {
  // No countdown timer — with interrupt-based flow, runs persist until user responds.
  const [submitted, setSubmitted] = useState(false);

  const handleDecide = useCallback(
    (decision: 'accept' | 'reject', text?: string) => {
      if (submitted) return;
      setSubmitted(true);
      onDecide(approvalId, decision, text);
      onDismiss?.();
    },
    [submitted, approvalId, onDecide, onDismiss],
  );

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

  // Not every skill edit is a text edit: a scope move or an auto-invocation
  // flip leaves both diffs empty, so they get spelled out as their own rows —
  // otherwise the panel asks for approval of nothing visible.
  const invocationLabel = (disabled?: boolean) =>
    disabled ? 'slash command only' : 'model + slash command';
  const changes: { label: string; value: string }[] = [];
  if (action !== 'delete') {
    if (newScope && newScope !== scope)
      changes.push({ label: 'Scope', value: `${scope} → ${newScope}` });
    if (
      oldDisableModelInvocation !== undefined &&
      disableModelInvocation !== undefined &&
      oldDisableModelInvocation !== disableModelInvocation
    )
      changes.push({
        label: 'Invocation',
        value: `${invocationLabel(oldDisableModelInvocation)} → ${invocationLabel(disableModelInvocation)}`,
      });
  }

  return (
    <ApprovalPanel
      icon={BookOpen}
      title={actionLabel}
      chips={
        <>
          <ApprovalChip>{name}</ApprovalChip>
          <span className="shrink-0 text-xs text-fg-subtle bg-surface-2 px-2 py-0.5 rounded-pill">
            {scope}
          </span>
        </>
      }
      onDismiss={() => handleDecide('reject')}
      rejection={{ onSubmit: (reason) => handleDecide('reject', reason) }}
      footer={
        <Button
          variant="primary"
          size="lg"
          icon={Check}
          onClick={() => handleDecide('accept')}
        >
          Accept
        </Button>
      }
    >
      {action === 'delete' ? (
        <div className="px-5 py-4 text-sm text-fg-muted border-b border-surface-2">
          This will permanently delete the skill <strong>{name}</strong>.
        </div>
      ) : null}

      {changes.length > 0 && (
        <dl className="px-5 py-3 border-b border-surface-2 space-y-1">
          {changes.map(({ label, value }) => (
            <div key={label} className="flex items-baseline gap-2 text-sm">
              <dt className="text-xs text-fg-subtle w-20 shrink-0">{label}</dt>
              <dd className="text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {action !== 'delete' && !showDiff && changes.length === 0 && (
        <div className="px-5 py-4 text-sm text-fg-muted border-b border-surface-2">
          No changes — <strong className="text-fg">{name}</strong> already
          matches this proposal.
        </div>
      )}

      {action !== 'delete' && showDiff ? (
        <div className="border-b border-surface-2">
          {oldDescription !== newDescription && (
            <div className="px-5 py-2 border-b border-surface-2">
              <p className="text-xs text-fg-subtle mb-1">Description</p>
              <DiffTable lines={computeDiff(oldDescription, newDescription)} />
            </div>
          )}
          {oldContent !== newContent && (
            <div>
              <p className="text-xs text-fg-subtle px-5 pt-2">Content</p>
              <DiffTable lines={computeDiff(oldContent, newContent)} />
            </div>
          )}
        </div>
      ) : null}
    </ApprovalPanel>
  );
}
