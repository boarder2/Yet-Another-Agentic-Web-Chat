'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ChartWidget from '@/components/ChartWidget';
import { useChartSpec } from '@/lib/chart/ChartSpecContext';

// Code-widget output is an arbitrary HTML string (already sanitized by
// sanitizeWidgetMarkdown) with <Chart id="cN"/> placeholders embedded by the
// sandbox `chart()` helper. We must NOT route it through markdown-to-jsx: its
// HTML-block parser mishandles nested same-tag elements (e.g. sibling <div>s)
// and duplicates trailing content.
//
// We also must NOT split the string at the chart placeholders and render the
// pieces in separate elements — that detaches a chart from its surrounding
// markup, so a <Chart/> nested in a styled container (exactly what the
// theme-aware guidance encourages) ends up rendered OUTSIDE that container.
// Instead we render the whole fragment once via dangerouslySetInnerHTML
// (preserving the tree), swap each <Chart/> for an empty marker span in place,
// and portal a React <ChartWidget> into each marker so structure is preserved.

const CHART_TAG_SOURCE =
  '<Chart\\b[^>]*?\\bid=["\']([^"\']*)["\'][^>]*?\\/?>(?:\\s*<\\/Chart>)?';

// Fragment-root tags that signal an HTML document fragment (vs. markdown that
// merely contains an inline tag). markdown-to-jsx duplicates nested same-tag
// block elements, so these must be rendered as raw HTML; anything else — incl.
// markdown that opens with an inline <img> or ends with an autolink like
// <https://x> — stays on the markdown path.
const HTML_ROOT_RE =
  /^<(?:div|section|article|main|aside|header|footer|nav|figure|figcaption|table|thead|tbody|tfoot|tr|ul|ol|dl|details|blockquote|pre|form|fieldset|h[1-6]|p|Chart)\b/;

/**
 * Heuristic: is this widget output an HTML document fragment (vs. markdown)?
 * Code widgets may emit either. We treat content as HTML only when it opens
 * with a fragment-root tag AND closes with a tag, which matches the typical
 * single-root `<div>…</div>` (or self-closing `<Chart/>`) output without
 * misclassifying markdown that merely starts or ends with an inline tag.
 */
export const looksLikeHtml = (content: string): boolean => {
  const trimmed = content.trim();
  if (!trimmed.startsWith('<') || !HTML_ROOT_RE.test(trimmed)) return false;
  return /(?:<\/[a-zA-Z][^>]*>|\/>)\s*$/.test(trimmed);
};

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const ChartPortal = ({ id, target }: { id: string; target: Element }) => {
  const spec = useChartSpec(id);
  return createPortal(
    spec ? (
      <ChartWidget spec={spec} />
    ) : (
      <div className="my-3 bg-surface border border-surface-2 rounded-surface px-4 py-3 text-sm text-fg/60 italic">
        Loading chart…
      </div>
    ),
    target,
  );
};

const WidgetHtmlContent = ({ content }: { content: string }) => {
  // Swap each <Chart/> placeholder for an empty marker span, keeping it in its
  // original position in the tree so nesting is preserved.
  const html = useMemo(
    () =>
      content.replace(
        new RegExp(CHART_TAG_SOURCE, 'g'),
        (_m, id: string) =>
          `<span data-widget-chart="${escapeAttr(id)}"></span>`,
      ),
    [content],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<Array<{ id: string; el: Element }>>(
    [],
  );

  // After the fragment is committed to the DOM, collect the marker spans so we
  // can portal charts into them. Re-runs whenever the HTML changes.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      setTargets([]);
      return;
    }
    const els = Array.from(root.querySelectorAll('[data-widget-chart]'));
    setTargets(
      els.map((el) => ({ id: el.getAttribute('data-widget-chart') ?? '', el })),
    );
  }, [html]);

  return (
    <>
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />
      {targets.map((t, i) => (
        <ChartPortal key={i} id={t.id} target={t.el} />
      ))}
    </>
  );
};

export default WidgetHtmlContent;
