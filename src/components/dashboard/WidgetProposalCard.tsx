'use client';

import { useMemo } from 'react';
import { diffLines } from 'diff';
import { Check, X } from 'lucide-react';
import { WidgetBuilderState } from '@/lib/tools/agents/widgetBuilderTools';

export interface WidgetProposal {
  revision: number;
  proposed: WidgetBuilderState;
  rationale: string;
}

interface Props {
  proposal: WidgetProposal;
  current: WidgetBuilderState;
  stale: boolean;
  onAccept: () => void;
  onReject: () => void;
}

const WidgetProposalCard = ({
  proposal,
  current,
  stale,
  onAccept,
  onReject,
}: Props) => {
  const codeDiff = useMemo(
    () => diffLines(current.code, proposal.proposed.code),
    [current.code, proposal.proposed.code],
  );
  const titleChanged = current.title !== proposal.proposed.title;
  const sourcesChanged =
    JSON.stringify(current.sources) !==
    JSON.stringify(proposal.proposed.sources);
  const codeChanged = current.code !== proposal.proposed.code;

  return (
    <div className="rounded-control border border-accent/40 bg-surface-2/40 p-3 space-y-2 text-sm">
      <p className="text-fg/80">{proposal.rationale}</p>

      {titleChanged && (
        <p className="text-xs">
          <span className="text-fg/60">Title: </span>
          <span className="line-through text-danger/80">
            {current.title}
          </span> →{' '}
          <span className="text-success">{proposal.proposed.title}</span>
        </p>
      )}

      {sourcesChanged && (
        <div className="text-xs text-fg/70">
          <span className="text-fg/60">Sources → </span>
          {proposal.proposed.sources.length === 0
            ? '(none)'
            : proposal.proposed.sources
                .map((s) => `${s.type} ${s.url}`)
                .join(', ')}
        </div>
      )}

      {codeChanged && (
        <pre className="text-xs max-h-60 overflow-auto rounded-control bg-bg p-2 font-mono leading-relaxed">
          {codeDiff.map((part, i) => (
            <span
              key={i}
              className={
                part.added
                  ? 'block bg-success-soft text-success'
                  : part.removed
                    ? 'block bg-danger-soft text-danger line-through'
                    : 'block text-fg/60'
              }
            >
              {part.value.replace(/\n$/, '')}
            </span>
          ))}
        </pre>
      )}

      {stale ? (
        <p className="text-xs text-warning">
          Widget changed since this proposal — ask the assistant to re-read and
          re-propose.
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-control bg-accent text-accent-fg hover:bg-accent-700"
          >
            <Check size={13} /> Accept &amp; Preview
          </button>
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-control bg-surface hover:bg-surface-2 text-fg"
          >
            <X size={13} /> Reject
          </button>
        </div>
      )}
    </div>
  );
};

export default WidgetProposalCard;
