import React, { useState } from 'react';
import { CheckCircle, XCircle, LoaderCircle, Users } from 'lucide-react';
import Markdown, { MarkdownToJSX } from 'markdown-to-jsx';
import { cn } from '@/lib/utils';
import {
  decodePanelColumns,
  type PanelExecutorView,
} from '@/lib/utils/panelMarkup';

/**
 * Renders the agent panel's executor columns. All executors live in a single
 * `<PanelColumns data="base64json">` block; this component decodes that blob and
 * lays the executors out side-by-side on desktop and as tabbed/stacked cards on
 * mobile. The orchestrator's synthesized answer renders as the normal message
 * body below this block.
 */

const stripThinkContent = (text: string): string => {
  let result = text.replace(/<think[^>]*>[\s\S]*?<\/think>/g, '');
  if (result.includes('</think>')) {
    result = result.replace(
      /(^|<\/[a-zA-Z][a-zA-Z0-9]*\s*>)[\s\S]*?<\/think>/g,
      '$1',
    );
  }
  return result.trim();
};

const columnMarkdownOptions: MarkdownToJSX.Options = {
  overrides: {
    code: {
      component: ({ className, children }) =>
        className ? (
          <pre className="bg-surface-2 rounded-control p-2 overflow-x-auto my-2">
            <code className={className}>{children}</code>
          </pre>
        ) : (
          <code className="px-1.5 py-0.5 rounded-control bg-surface-2 font-mono text-xs">
            {children}
          </code>
        ),
    },
    pre: { component: ({ children }) => children },
    a: {
      component: (props) => (
        <a
          {...props}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        />
      ),
    },
    iframe: () => null,
    script: () => null,
    object: () => null,
    style: () => null,
  },
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'success')
    return <CheckCircle size={14} className="text-success shrink-0" />;
  if (status === 'error')
    return <XCircle size={14} className="text-danger shrink-0" />;
  return (
    <LoaderCircle size={14} className="animate-spin text-accent shrink-0" />
  );
};

const Column: React.FC<{ ex: PanelExecutorView }> = ({ ex }) => {
  const text = stripThinkContent(ex.responseText || '');
  return (
    <div className="flex flex-col min-w-0 border border-surface-2 rounded-surface bg-surface overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-surface-2 bg-surface-2/40">
        <StatusIcon status={ex.status} />
        <span className="font-medium text-xs truncate flex-1" title={ex.model}>
          {ex.model}
        </span>
        {ex.sourceCount !== undefined && ex.sourceCount > 0 && (
          <span className="text-[10px] text-fg/60 shrink-0">
            {ex.sourceCount} src
          </span>
        )}
        {ex.tokens !== undefined && ex.tokens > 0 && (
          <span className="text-[10px] text-fg/50 shrink-0">
            {ex.tokens >= 1000
              ? `${(ex.tokens / 1000).toFixed(1)}k tok`
              : `${ex.tokens} tok`}
          </span>
        )}
      </div>
      <div className="px-3 py-2 max-h-72 overflow-y-auto text-sm">
        {ex.status === 'error' ? (
          <div className="text-xs text-danger font-mono whitespace-pre-wrap">
            {ex.error || 'This model failed to produce an answer.'}
          </div>
        ) : text ? (
          <div
            className={cn(
              'prose prose-sm dark:prose-invert max-w-none',
              'prose-p:leading-relaxed prose-p:my-1.5',
              'prose-headings:font-semibold prose-h1:text-base prose-h2:text-sm prose-h3:text-sm',
              'prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5',
              'prose-code:bg-surface-2 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-control',
              'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
              'wrap-break-word',
            )}
          >
            <Markdown options={columnMarkdownOptions}>{text}</Markdown>
          </div>
        ) : (
          <div className="text-xs text-fg/50 italic">Researching…</div>
        )}
      </div>
    </div>
  );
};

interface PanelColumnsProps {
  data?: string;
}

export const PanelColumns: React.FC<PanelColumnsProps> = ({ data }) => {
  const { executors } = decodePanelColumns(data ?? '');
  const [activeIdx, setActiveIdx] = useState(0);

  if (executors.length === 0) return null;

  const active = executors.find((e) => e.idx === activeIdx) ?? executors[0];

  return (
    <div className="my-3">
      <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-fg/70 uppercase tracking-wide">
        <Users size={14} className="text-accent" />
        Agent Panel · {executors.length} models
      </div>

      {/* Mobile: tab selector + single active column */}
      <div className="sm:hidden">
        <div className="flex gap-1.5 mb-2 overflow-x-auto">
          {executors.map((ex) => (
            <button
              key={ex.idx}
              type="button"
              onClick={() => setActiveIdx(ex.idx)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-control text-xs whitespace-nowrap transition-colors duration-150',
                ex.idx === active.idx
                  ? 'bg-accent text-accent-fg'
                  : 'bg-surface-2 text-fg/70 hover:text-fg',
              )}
            >
              <StatusIcon status={ex.status} />
              <span className="truncate max-w-[120px]">{ex.model}</span>
            </button>
          ))}
        </div>
        <Column ex={active} />
      </div>

      {/* Desktop: all columns side-by-side */}
      <div className="hidden sm:flex sm:flex-wrap gap-3">
        {executors.map((ex) => (
          <div key={ex.idx} className="flex-1 min-w-[240px]">
            <Column ex={ex} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PanelColumns;
