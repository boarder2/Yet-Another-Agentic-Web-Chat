'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import Markdown, { MarkdownToJSX } from 'markdown-to-jsx';
import ThinkBox from './ThinkBox';
import { CodeBlock } from './CodeBlock';
import { Document } from '@langchain/core/documents';
import CitationLink from './CitationLink';
import { decodeBase64 } from '@/lib/utils/html';
import { ToolCall } from './MessageActions/ToolCall';
import { SubagentExecution } from './MessageActions/SubagentExecution';
import { PanelColumns } from './MessageActions/PanelColumns';
import ArtifactCard from './Artifacts/ArtifactCard';
import ArtifactMention from './Artifacts/ArtifactMention';
import { parseArtifactHref } from '@/lib/artifacts/mention';
import ChartElement, { spaceChartTags } from './ChartElement';
import ChartEnvelope from './ChartEnvelope';
import {
  maskWidgets,
  parseWidgetCodeBlock,
  unmaskWidgets,
} from '@/lib/widgets/envelope';

/**
 * Pattern matching known custom element closing tags (ToolCall, SubagentExecution, Chart).
 * Used as boundaries to distinguish markdown content from orphaned think text.
 * Must NOT match arbitrary HTML-like tags that models may produce in their
 * thinking output (e.g. </parameter>, </tool>, </result>).
 */
const KNOWN_CLOSING_TAG =
  '<\\/(?:ToolCall|SubagentExecution|PanelColumns|Chart)\\s*>';

/**
 * Ensure legacy custom block elements (ToolCall, SubagentExecution,
 * PanelColumns, Chart) are surrounded by blank lines so markdown-to-jsx treats
 * them as block-level HTML rather than inline content — without this the
 * parser wraps them in <p>, causing an invalid <p><div> nesting hydration
 * error. Only applies to old messages: current widgets are fenced code blocks,
 * which markdown-to-jsx already treats as block-level.
 *
 * SubagentExecution/PanelColumns blocks are placeholder-protected before the
 * ToolCall pass so a ToolCall nested inside one isn't individually
 * blank-line-wrapped — that used to make markdown-to-jsx end the parent's HTML
 * block at the blank line and spill the nested ToolCall out as a top-level
 * sibling (plus an orphaned duplicate parent from the dangling close tag).
 */
const ensureBlockElements = (text: string): string => {
  const placeholders: string[] = [];
  const protectedText = text.replace(
    /<(SubagentExecution|PanelColumns)\b[^>]*>[\s\S]*?<\/\1>/g,
    (match) => {
      placeholders.push(match);
      return `@@WIDGET_${placeholders.length - 1}@@`;
    },
  );
  const withToolCallsSpaced = protectedText.replace(
    /(<ToolCall\b[^>]*>[\s\S]*?<\/ToolCall>)/g,
    '\n\n$1\n\n',
  );
  const restored = withToolCallsSpaced.replace(
    /@@WIDGET_(\d+)@@/g,
    (_m, i: string) => placeholders[Number(i)],
  );
  return spaceChartTags(
    restored
      .replace(
        /(<SubagentExecution\b[^>]*>[\s\S]*?<\/SubagentExecution>)/g,
        '\n\n$1\n\n',
      )
      .replace(
        /(<PanelColumns\b[^>]*>[\s\S]*?<\/PanelColumns>)/g,
        '\n\n$1\n\n',
      ),
  );
};

/**
 * Remove think-tag content, handling both properly paired <think>...</think>
 * and orphaned </think> (no opening tag) from providers like LM Studio.
 */
const removeThinkTags = (content: string): string => {
  // Remove properly paired <think>...</think>
  let result = content.replace(/<think[^>]*>[\s\S]*?<\/think>/g, '');
  // Remove orphaned </think> and text preceding them (think content without opening tag).
  // Only treats known custom element closing tags as boundaries; arbitrary HTML-like
  // tags in model thinking output (e.g. </parameter>) are treated as think content.
  if (result.includes('</think>')) {
    result = result.replace(
      new RegExp(`(^|${KNOWN_CLOSING_TAG})([\\s\\S]*?)<\\/think>`, 'g'),
      '$1',
    );
  }
  return result.trim();
};

// Split content into alternating markdown and think segments.
// This must happen before markdown-to-jsx sees the content because the library
// only treats standard HTML5 block elements as block HTML; <think> is unknown
// and treated as inline, causing blank lines inside it to end the HTML block
// and spill the remaining thinking text as plain markdown.
interface ContentSegment {
  type: 'markdown' | 'think';
  content: string;
  id: string;
}

/**
 * Split content by think blocks, handling both:
 * 1. Properly paired <think>...</think>
 * 2. Orphaned </think> (no opening <think>) from providers like LM Studio
 *    that stream thinking content as regular text.
 */
const splitByThinkBlocks = (content: string): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  // Match either a proper <think>...</think> pair (group 1) or a standalone </think>
  const regex = /<think(?:\s[^>]*)?>([\s\S]*?)<\/think>|<\/think>/g;
  let lastIndex = 0;
  let thinkCounter = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match[1] !== undefined) {
      // Properly paired <think>...</think>
      if (match.index > lastIndex) {
        segments.push({
          type: 'markdown',
          content: content.slice(lastIndex, match.index),
          id: `md-${segments.length}`,
        });
      }
      segments.push({
        type: 'think',
        content: match[1].trim(),
        id: `think-${thinkCounter++}`,
      });
    } else {
      // Orphaned </think> — content since lastIndex is a mix of
      // possible HTML tags (ToolCall, etc.) followed by think text.
      const chunk = content.slice(lastIndex, match.index);

      if (chunk.trim()) {
        // Find the boundary: everything up to and including the last
        // known custom element closing tag is markdown; everything after is think text.
        // Only ToolCall and SubagentExecution are treated as boundaries — arbitrary
        // HTML-like tags in model output (e.g. </parameter>) are think content.
        const boundary = chunk.match(
          new RegExp(`^([\\s\\S]*${KNOWN_CLOSING_TAG})([\\s\\S]*)$`),
        );

        if (boundary) {
          const [, markdownPart, thinkPart] = boundary;
          if (markdownPart.trim()) {
            segments.push({
              type: 'markdown',
              content: markdownPart,
              id: `md-${segments.length}`,
            });
          }
          if (thinkPart.trim()) {
            segments.push({
              type: 'think',
              content: thinkPart.trim(),
              id: `think-${thinkCounter++}`,
            });
          }
        } else {
          // No HTML tags in chunk — entire chunk is think content
          segments.push({
            type: 'think',
            content: chunk.trim(),
            id: `think-${thinkCounter++}`,
          });
        }
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: 'markdown',
      content: content.slice(lastIndex),
      id: `md-${segments.length}`,
    });
  }

  return segments;
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
  showThinking?: boolean;
  messageId?: string;
  expandedThinkBoxes?: Set<string>;
  onThinkBoxToggle?: (
    messageId: string,
    thinkBoxId: string,
    expanded: boolean,
  ) => void;
  sources?: Document[];
}

/**
 * markdown-to-jsx override for legacy `<ToolCall>` tags (old messages, no data
 * migration): base64-decodes the long-content attributes that old writers
 * encoded to protect the markdown parser, then renders the same `ToolCall`
 * presentational component current fenced widgets use (which expects plain
 * text for these fields).
 */
const LegacyToolCall = (props: Record<string, unknown>) => {
  const decode = (v: unknown) =>
    typeof v === 'string' && v ? decodeBase64(v) : v;
  return (
    <ToolCall
      {...props}
      code={decode(props.code) as string | undefined}
      stdout={decode(props.stdout) as string | undefined}
      stderr={decode(props.stderr) as string | undefined}
      mcpArgs={decode(props.mcpArgs) as string | undefined}
      mcpResult={decode(props.mcpResult) as string | undefined}
    />
  );
};

/**
 * Dispatch a fenced code block to a widget component when its info string is
 * a known `yaawc:*` envelope, falling back to the plain code block renderer
 * for everything else (including malformed/unknown `yaawc:*` fences — a
 * visible, debuggable fallback rather than silently dropping content).
 */
const WidgetOrCodeBlock = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  const parsed = parseWidgetCodeBlock(className, children);
  if (parsed) {
    if (parsed.kind === 'tool_call') return <ToolCall {...parsed.payload} />;
    if (parsed.kind === 'subagent')
      return <SubagentExecution {...parsed.payload} />;
    if (parsed.kind === 'artifact') return <ArtifactCard {...parsed.payload} />;
    if (parsed.kind === 'chart')
      return <ChartEnvelope chartId={parsed.payload.chartId} />;
    return <PanelColumns columns={parsed.payload.columns} />;
  }
  if (className) {
    // Fenced code block with language specifier
    return <CodeBlock className={className}>{children}</CodeBlock>;
  }
  // Fenced code block without language specifier — content contains newlines
  if (typeof children === 'string' && children.includes('\n')) {
    return <CodeBlock className="text">{children}</CodeBlock>;
  }
  // Inline code block (`code`)
  return (
    <code className="px-1.5 py-0.5 rounded-control bg-surface-2 font-mono text-sm">
      {children}
    </code>
  );
};

// Override components must live at module scope: markdown-to-jsx element types
// need referential identity across renders, or React remounts the subtree of
// every overridden element (resetting widget state, restarting spinners) on
// each streamed token.
const SkillTokenElement = ({ children }: { children?: React.ReactNode }) => (
  <span className="text-accent font-mono">{children}</span>
);

const StrongElement = ({ children }: { children?: React.ReactNode }) => (
  <strong className="font-bold">{children}</strong>
);

const PreElement = ({ children }: { children?: React.ReactNode }) => children;

const NullElement = () => null;

const MarkdownAnchor = ({
  sources,
  ...props
}: React.ComponentProps<'a'> & {
  sources?: Document[];
  'data-citation'?: string;
}) => {
  // `@[Title](artifact:<id>)` — a user mention of a document, not a link.
  const mentionedArtifact = parseArtifactHref(props.href ?? '');
  if (mentionedArtifact) {
    return (
      <ArtifactMention artifactId={mentionedArtifact}>
        {props.children}
      </ArtifactMention>
    );
  }

  // Check if this is a citation link with data-citation attribute
  const citationNumber = props['data-citation'];

  if (sources && citationNumber) {
    const number = parseInt(citationNumber);
    const source = sources[number - 1];

    if (source) {
      return (
        <CitationLink
          number={number.toString()}
          source={source}
          url={props.href}
        />
      );
    }
  }

  // Rewrite absolute URLs pointing to internal chat paths so the LLM
  // can't accidentally anchor them to a hallucinated domain.
  const href = props.href ?? '';
  let resolvedHref = href;
  try {
    const parsed = new URL(href);
    if (/^\/(workspaces\/[^/]+\/)?c\/[a-f0-9]+\/?$/.test(parsed.pathname)) {
      resolvedHref = parsed.pathname;
    }
  } catch {
    // href is already relative — leave it alone
  }

  // Default link behavior
  return (
    <a
      {...props}
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
    />
  );
};

const ThinkTagProcessor = ({
  children,
  id,
  isExpanded,
  onToggle,
}: {
  children: React.ReactNode;
  id?: string;
  isExpanded?: boolean;
  onToggle?: (thinkBoxId: string, expanded: boolean) => void;
}) => {
  return (
    <ThinkBox
      content={children}
      expanded={isExpanded}
      onToggle={() => {
        if (id && onToggle) {
          onToggle(id, !isExpanded);
        }
      }}
    />
  );
};
const MarkdownRenderer = ({
  content,
  className,
  showThinking = true,
  messageId,
  expandedThinkBoxes,
  onThinkBoxToggle,
  sources,
}: MarkdownRendererProps) => {
  // Check if a think box is expanded
  const isThinkBoxExpanded = (thinkBoxId: string) => {
    return expandedThinkBoxes?.has(thinkBoxId) || false;
  };

  // Handle think box toggle
  const handleThinkBoxToggle = (thinkBoxId: string, expanded: boolean) => {
    if (messageId && onThinkBoxToggle) {
      onThinkBoxToggle(messageId, thinkBoxId, expanded);
    }
  };

  // Markdown formatting options — <think> is intentionally absent; handled pre-render
  const markdownOverrides: MarkdownToJSX.Options = {
    overrides: {
      // Legacy tag markup (old messages, no data migration) — frozen, read-only.
      ToolCall: {
        component: LegacyToolCall,
      },
      SubagentExecution: {
        component: SubagentExecution,
      },
      PanelColumns: {
        component: PanelColumns,
      },
      // Legacy historical chat/dashboard placeholders only. New chat placement
      // is writer-authored by show_chart and dispatched from yaawc:chart above.
      Chart: {
        component: ChartElement,
      },
      SkillToken: {
        component: SkillTokenElement,
      },
      // Fenced code blocks — dispatches yaawc:* widget envelopes, falls back
      // to the plain code block renderer for everything else.
      code: {
        component: WidgetOrCodeBlock,
      },
      strong: {
        component: StrongElement,
      },
      pre: {
        component: PreElement,
      },
      a: {
        component: MarkdownAnchor,
        props: { sources },
      },
      // Prevent rendering of certain HTML elements for security
      iframe: NullElement,
      script: NullElement,
      object: NullElement,
      style: NullElement,
    },
  };

  if (!content || content.length === 0) return null;

  const proseClassName = cn(
    'prose prose-theme dark:prose-invert prose-h1:mb-3 prose-h2:mb-2 prose-h2:mt-6 prose-h2:font-[800] prose-h3:mt-4 prose-h3:mb-1.5 prose-h3:font-[600] prose-p:leading-relaxed prose-pre:p-0 font-[400]',
    'prose-code:bg-transparent prose-code:p-0 prose-code:text-inherit prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
    'prose-pre:bg-transparent prose-pre:border-0 prose-pre:m-0 prose-pre:p-0',
    'prose-strong:font-bold',
    'break-words max-w-full',
    className,
  );

  // Widget payloads are opaque model text on a single JSON line: preprocessing
  // below must not rewrite inside them, so they ride through as placeholders and
  // are restored on the way into markdown-to-jsx.
  const { text: masked, fences } = maskWidgets(content);
  const forMarkdown = (text: string) =>
    unmaskWidgets(ensureBlockElements(text), fences);

  // For showThinking=false, strip think blocks entirely and render as plain markdown
  if (!showThinking) {
    const stripped = removeThinkTags(masked);
    if (!stripped || stripped.length === 0) return null;
    return (
      <div className="relative">
        <Markdown className={proseClassName} options={markdownOverrides}>
          {forMarkdown(stripped)}
        </Markdown>
      </div>
    );
  }

  // Split content into segments so <think> blocks are extracted before markdown-to-jsx
  // processes them (the library would mis-parse multi-paragraph think blocks as plain text).
  const segments = splitByThinkBlocks(masked);

  // Fast path: no think blocks present — render content directly
  if (segments.length === 0) return null;
  if (segments.length === 1 && segments[0].type === 'markdown') {
    return (
      <div className="relative">
        <Markdown className={proseClassName} options={markdownOverrides}>
          {forMarkdown(masked)}
        </Markdown>
      </div>
    );
  }

  // Segment rendering: think blocks become ThinkBox components, markdown renders normally
  return (
    <div className="relative">
      {segments.map((segment) => {
        if (segment.type === 'think') {
          if (!segment.content) return null;
          return (
            <ThinkTagProcessor
              key={segment.id}
              id={segment.id}
              isExpanded={isThinkBoxExpanded(segment.id)}
              onToggle={handleThinkBoxToggle}
            >
              <MarkdownRenderer
                content={unmaskWidgets(segment.content, fences)}
                showThinking={false}
                sources={sources}
              />
            </ThinkTagProcessor>
          );
        }

        const trimmed = segment.content.trim();
        if (!trimmed) return null;
        return (
          <Markdown
            key={segment.id}
            className={proseClassName}
            options={markdownOverrides}
          >
            {forMarkdown(segment.content)}
          </Markdown>
        );
      })}
    </div>
  );
};

// Memoized so a streaming commit only re-parses the message whose content
// actually changed, not every message in the chat.
export default memo(MarkdownRenderer);
