'use client';

import { useMemo } from 'react';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import { ChartSpecContext } from '@/lib/chart/ChartSpecContext';
import { ChartSpec } from '@/lib/chart/chartSpec';
import { sanitizeWidgetMarkdown } from '@/lib/dashboard/sanitizeWidgetOutput';
import { cn } from '@/lib/utils';
import WidgetHtmlContent, { looksLikeHtml } from './WidgetHtmlContent';

interface WidgetContentProps {
  /** Raw widget output (markdown or an HTML fragment). Sanitized here. */
  content: string | null;
  /** Chart specs keyed by id, for <Chart id="cN"/> placeholders. */
  charts?: Record<string, ChartSpec>;
  showThinking?: boolean;
  /** Extra classes for the prose wrapper (e.g. max-width). */
  className?: string;
}

/**
 * Canonical renderer for widget output. The dashboard and every preview panel
 * use this so a preview always matches what the saved widget will display.
 *
 * Output is sanitized, then rendered as raw HTML when it's an HTML fragment
 * (markdown-to-jsx duplicates nested same-tag elements, so it must be bypassed)
 * or as markdown otherwise. Charts resolve through ChartSpecContext.
 */
const WidgetContent = ({
  content,
  charts,
  showThinking = false,
  className,
}: WidgetContentProps) => {
  const safe = useMemo(() => sanitizeWidgetMarkdown(content), [content]);
  const chartSpecValue = useMemo(
    () => ({ getChartSpec: (id: string) => charts?.[id] }),
    [charts],
  );

  return (
    <ChartSpecContext.Provider value={chartSpecValue}>
      <div className={cn('prose prose-sm', className)}>
        {looksLikeHtml(safe) ? (
          <WidgetHtmlContent content={safe} />
        ) : (
          <MarkdownRenderer content={safe} showThinking={showThinking} />
        )}
      </div>
    </ChartSpecContext.Provider>
  );
};

export default WidgetContent;
