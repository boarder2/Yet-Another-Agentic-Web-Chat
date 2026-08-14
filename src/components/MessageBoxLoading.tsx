import type { Document } from '@langchain/core/documents';
import MessageSource from './MessageSource';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface SourceGroup {
  searchQuery: string;
  sources: Document[];
}

interface MessageBoxLoadingProps {
  actionMessageId?: string;
  onAnswerNow?: () => void;
  gatheringSources?: SourceGroup[];
}

const MessageBoxLoading = ({
  actionMessageId,
  onAnswerNow,
  gatheringSources = [],
}: MessageBoxLoadingProps) => {
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);
  const [isAnsweringNow, setIsAnsweringNow] = useState(false);
  return (
    <div className="flex flex-col space-y-4 w-full lg:w-9/12">
      {/* Sources gathered during search phase */}
      {gatheringSources.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSourcesExpanded(!isSourcesExpanded)}
                className="flex items-center gap-1 border border-transparent text-sm font-semibold text-fg/90 hover:text-fg transition-colors duration-150 focus-border-neutral"
              >
                <svg
                  className={`w-4 h-4 transition-transform duration-150 ${isSourcesExpanded ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                Relevant Sources Gathered (
                {gatheringSources.reduce(
                  (acc, group) => acc + group.sources.length,
                  0,
                )}
                )
              </button>
            </div>
            {/* Answer now control */}
            {actionMessageId && gatheringSources.length > 0 && (
              <div className="">
                <Button
                  onClick={async (e) => {
                    try {
                      // Disable the button immediately to prevent double clicks
                      (e.currentTarget as HTMLButtonElement).disabled = true;
                      setIsAnsweringNow(true);
                      if (onAnswerNow) {
                        onAnswerNow();
                      } else {
                        await fetch('/api/respond-now', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ messageId: actionMessageId }),
                        });
                      }
                    } catch (_e) {
                      // no-op
                    }
                  }}
                  loading={isAnsweringNow}
                  variant="primary"
                  size="sm"
                  className="w-28"
                >
                  Answer now
                </Button>
              </div>
            )}
          </div>
          {isSourcesExpanded && (
            <div className="mt-4 space-y-4">
              {gatheringSources.map((group, groupIndex) => (
                <div key={groupIndex} className="space-y-2">
                  <div className="text-xs font-medium text-fg-muted bg-surface-2 px-2 py-1 rounded-control">
                    Search: &quot;{group.searchQuery}&quot;
                  </div>
                  <div className="grid gap-2">
                    {group.sources.map((source, sourceIndex) => (
                      <MessageSource
                        key={`${groupIndex}-${sourceIndex}`}
                        source={source}
                        className="text-xs p-2"
                        style={{ minHeight: 'auto' }}
                        oneLiner
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default MessageBoxLoading;
