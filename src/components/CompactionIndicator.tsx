import { useState } from 'react';
import { ChevronDown, ChevronUp, FolderArchive } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { formatTokens } from '@/lib/utils/tokens';
import type { CompactionData } from './ChatWindow';

export default function CompactionIndicator({
  compaction,
}: {
  compaction: CompactionData;
}) {
  const [expanded, setExpanded] = useState(false);

  const saved = compaction.tokensBefore - compaction.tokensAfter;
  const pct =
    compaction.tokensBefore > 0
      ? Math.round((saved / compaction.tokensBefore) * 100)
      : 0;

  return (
    <div className="border border-border-strong rounded-surface bg-surface my-6">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <FolderArchive className="size-4 text-accent shrink-0" />
          <span className="text-sm font-semibold text-fg">
            Conversation compacted
          </span>
        </div>
        <p className="text-xs text-fg opacity-75 mt-1 mb-1">
          Compacted {compaction.compactedMessageCount} messages
          {' • '}
          {formatTokens(compaction.tokensBefore)} →{' '}
          {formatTokens(compaction.tokensAfter)} tokens
          {saved > 0 && ` (${pct}% saved)`}
        </p>
        {compaction.summary && (
          <div className="mt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-accent transition-colors duration-150 flex items-center gap-1 mb-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="size-3" />
                  Hide summary
                </>
              ) : (
                <>
                  <ChevronDown className="size-3" />
                  Show summary
                </>
              )}
            </button>
            {expanded && (
              <div className="text-sm text-fg">
                <MarkdownRenderer content={compaction.summary} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
