'use client';

import { cn } from '@/lib/utils';
import {
  CheckCheck,
  Search,
  FileText,
  Globe,
  Settings,
  Image as ImageIcon,
  ScanEye,
  BotIcon,
  TvIcon,
  X,
  LoaderCircle,
  Brain,
  Trash2,
  List,
  Terminal,
  HelpCircle,
  FolderOpen,
  FolderSearch,
  FileCode,
  FilePen,
  FilePlus,
} from 'lucide-react';
import { useState } from 'react';
import Markdown, { MarkdownToJSX } from 'markdown-to-jsx';
import ThinkBox from './ThinkBox';
import { CodeBlock } from './CodeBlock';
import { Document } from '@langchain/core/documents';
import CitationLink from './CitationLink';
import { decodeHtmlEntities, decodeBase64 } from '@/lib/utils/html';
import { SubagentExecution } from './MessageActions/SubagentExecution';

/**
 * Pattern matching known custom element closing tags (ToolCall, SubagentExecution).
 * Used as boundaries to distinguish markdown content from orphaned think text.
 * Must NOT match arbitrary HTML-like tags that models may produce in their
 * thinking output (e.g. </parameter>, </tool>, </result>).
 */
const KNOWN_CLOSING_TAG = '<\\/(?:ToolCall|SubagentExecution)\\s*>';

/**
 * Ensure custom block elements (ToolCall, SubagentExecution) are surrounded by
 * blank lines so markdown-to-jsx treats them as block-level HTML rather than
 * inline content. Without this, the parser wraps them in <p>, which causes an
 * invalid <p><div> nesting hydration error.
 */
const ensureBlockElements = (text: string): string =>
  text
    .replace(/(<ToolCall\b[^>]*>[\s\S]*?<\/ToolCall>)/g, '\n\n$1\n\n')
    .replace(
      /(<SubagentExecution\b[^>]*>[\s\S]*?<\/SubagentExecution>)/g,
      '\n\n$1\n\n',
    );

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

// Custom ToolCall component for markdown
const ToolCall = ({
  type,
  query,
  urls: _urls,
  url,
  videoId,
  count,
  status,
  error,
  code,
  description,
  exitCode,
  stdout,
  stderr,
  timedOut,
  oomKilled,
  denied,
  selectedOptions,
  freeformText,
  skipped,
  children,
}: {
  type?: string;
  query?: string;
  urls?: string;
  url?: string;
  videoId?: string;
  count?: string;
  status?: string; // running | success | error
  error?: string;
  code?: string;
  description?: string;
  exitCode?: string;
  stdout?: string;
  stderr?: string;
  timedOut?: string;
  oomKilled?: string;
  denied?: string;
  executionId?: string;
  selectedOptions?: string;
  freeformText?: string;
  skipped?: string;
  children?: React.ReactNode;
}) => {
  const [expanded, setExpanded] = useState(false);
  const getIcon = (toolType: string) => {
    switch (toolType) {
      case 'search':
      case 'web_search':
        return <Search size={16} className="text-accent" />;
      case 'file':
      case 'file_search':
        return <FileText size={16} className="text-accent" />;
      case 'url':
      case 'url_fetch':
      case 'url_summarization':
        return <Globe size={16} className="text-accent" />;
      case 'image':
      case 'image_search':
        return <ImageIcon size={16} className="text-accent" />;
      case 'image_analysis':
        return <ScanEye size={16} className="text-accent" />;
      case 'firefoxAI':
        return <BotIcon size={16} className="text-accent" />;
      case 'youtube_transcript':
        return <TvIcon size={16} className="text-danger" />;
      case 'pdf_loader':
        return <FileText size={16} className="text-danger" />;
      case 'save_memory':
        return <Brain size={16} className="text-accent" />;
      case 'delete_memory':
        return <Trash2 size={16} className="text-danger" />;
      case 'list_memories':
        return <List size={16} className="text-accent" />;
      case 'code_execution':
        return <Terminal size={16} className="text-accent" />;
      case 'ask_user':
        return <HelpCircle size={16} className="text-accent" />;
      case 'workspace_ls':
        return <FolderOpen size={16} className="text-accent" />;
      case 'workspace_grep':
        return <FolderSearch size={16} className="text-accent" />;
      case 'workspace_read':
        return <FileCode size={16} className="text-accent" />;
      case 'workspace_edit':
        return <FilePen size={16} className="text-accent" />;
      case 'workspace_create_file':
        return <FilePlus size={16} className="text-accent" />;
      default:
        return <Settings size={16} className="text-fg/70" />;
    }
  };

  const formatToolMessage = () => {
    if (type === 'search' || type === 'web_search') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Web search:</span>
          <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm">
            {decodeHtmlEntities(query || (children as string))}
          </span>
        </>
      );
    }

    if (type === 'file' || type === 'file_search') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>File search:</span>
          <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm">
            {decodeHtmlEntities(query || (children as string))}
          </span>
        </>
      );
    }

    if (
      type === 'url' ||
      type === 'url_fetch' ||
      type === 'url_summarization'
    ) {
      const urlCount = count ? parseInt(count) : 1;
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>
            Analyzing {urlCount} web page{urlCount === 1 ? '' : 's'} for
            additional details
          </span>
        </>
      );
    }

    if (type === 'pdf_loader' && url) {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Loading PDF document:</span>
          <a
            target="_blank"
            href={decodeHtmlEntities(url)}
            className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm"
          >
            {decodeHtmlEntities(url)}
          </a>
        </>
      );
    }

    if (type === 'image' || type === 'image_search') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Image search:</span>
          <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm">
            {decodeHtmlEntities(query || (children as string))}
          </span>
        </>
      );
    }

    if (type === 'image_analysis') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Analyzing image:</span>
          <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-xs">
            {decodeHtmlEntities(url || query || (children as string))}
          </span>
        </>
      );
    }

    if (type === 'firefoxAI') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Firefox AI detected, tools disabled</span>
        </>
      );
    }

    if (type === 'youtube_transcript' && videoId) {
      return (
        <div className="w-full">
          <div className="flex items-center mb-2">
            <span className="mr-2">{getIcon(type)}</span>
            <span>Retrieved YouTube Transcript</span>
          </div>
          <div className="mt-2 rounded-control">
            <div className="w-full">
              <iframe
                src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1`}
                className="w-full aspect-video rounded-floating"
                allowFullScreen
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              />
            </div>
          </div>
        </div>
      );
    }

    if (type === 'save_memory') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Saving memory:</span>
          {query && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-md">
              {decodeHtmlEntities(query)}
            </span>
          )}
        </>
      );
    }

    if (type === 'delete_memory') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Deleting memory:</span>
          {query && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-md">
              {decodeHtmlEntities(query)}
            </span>
          )}
        </>
      );
    }

    if (type === 'list_memories') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Retrieving stored memories</span>
        </>
      );
    }

    if (type === 'code_execution') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Code execution{description ? ':' : ''}</span>
          {description && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-md">
              {description}
            </span>
          )}
          {denied === 'true' && (
            <span className="ml-2 px-2 py-0.5 bg-danger-soft text-danger rounded-control text-xs">
              Denied
            </span>
          )}
          {timedOut === 'true' && (
            <span className="ml-2 px-2 py-0.5 bg-danger-soft text-danger rounded-control text-xs">
              Timed out
            </span>
          )}
          {oomKilled === 'true' && (
            <span className="ml-2 px-2 py-0.5 bg-danger-soft text-danger rounded-control text-xs">
              Out of memory
            </span>
          )}
          {expanded &&
            exitCode !== undefined &&
            denied !== 'true' &&
            timedOut !== 'true' &&
            oomKilled !== 'true' && (
              <span
                className={`ml-2 px-2 py-0.5 rounded-control text-xs ${
                  exitCode === '0'
                    ? 'bg-success-soft text-success'
                    : 'bg-danger-soft text-danger'
                }`}
              >
                Exit code: {exitCode}
              </span>
            )}
        </>
      );
    }

    if (type === 'ask_user') {
      const decodedQuery = decodeHtmlEntities(query ?? '');
      const decodedSelectedOptions = decodeHtmlEntities(selectedOptions ?? '');
      const decodedFreeformText = decodeHtmlEntities(freeformText ?? '');
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Asked user{decodedQuery ? ':' : ''}</span>
          {decodedQuery && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control text-sm truncate max-w-md">
              {decodedQuery}
            </span>
          )}
          {skipped === 'true' && (
            <span className="ml-2 px-2 py-0.5 bg-warning-soft text-warning rounded-control text-xs">
              Skipped
            </span>
          )}
          {timedOut === 'true' && (
            <span className="ml-2 px-2 py-0.5 bg-danger-soft text-danger rounded-control text-xs">
              Timed out
            </span>
          )}
          {decodedSelectedOptions && (
            <span className="ml-2 px-2 py-0.5 bg-success-soft text-success rounded-control text-xs">
              {decodedSelectedOptions}
            </span>
          )}
          {decodedFreeformText && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control text-sm truncate max-w-md">
              {decodedFreeformText}
            </span>
          )}
        </>
      );
    }

    if (type === 'workspace_ls') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Listing workspace files</span>
        </>
      );
    }

    if (type === 'workspace_grep') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Searching workspace{query ? ':' : ''}</span>
          {query && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-md">
              {decodeHtmlEntities(query)}
            </span>
          )}
        </>
      );
    }

    if (type === 'workspace_read') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Reading workspace file{query ? ':' : ''}</span>
          {query && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-md">
              {decodeHtmlEntities(query)}
            </span>
          )}
        </>
      );
    }

    if (type === 'workspace_edit') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Editing workspace file{query ? ':' : ''}</span>
          {query && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-md">
              {decodeHtmlEntities(query)}
            </span>
          )}
        </>
      );
    }

    if (type === 'workspace_create_file') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Creating workspace file{query ? ':' : ''}</span>
          {query && (
            <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm truncate max-w-md">
              {decodeHtmlEntities(query)}
            </span>
          )}
        </>
      );
    }

    // Fallback for unknown tool types
    return (
      <>
        <span className="mr-2">{getIcon(type || 'default')}</span>
        <span>Using tool:</span>
        <span className="ml-2 px-2 py-0.5 bg-fg/5 rounded-control font-mono text-sm border border-surface-2">
          {type || 'unknown'}
        </span>
      </>
    );
  };

  return (
    <div className="my-3 bg-surface border border-surface-2 rounded-surface overflow-hidden">
      <div
        className={`flex items-start justify-between gap-2 text-sm font-medium px-4 py-3 ${
          type === 'code_execution' && code
            ? 'cursor-pointer hover:bg-surface-2/50 transition-colors'
            : ''
        }`}
        onClick={
          type === 'code_execution' && code
            ? () => setExpanded(!expanded)
            : undefined
        }
      >
        <div className="flex items-center flex-wrap gap-1">
          {formatToolMessage()}
        </div>
        <div className="flex items-center gap-2 h-5">
          {type === 'code_execution' && code && (
            <svg
              className={`w-4 h-4 text-fg/50 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          )}
          {status === 'running' && (
            <div className="w-4 h-4">
              <LoaderCircle className="animate-spin text-accent" />
            </div>
          )}
          {status === 'success' &&
            denied !== 'true' &&
            exitCode !== undefined &&
            exitCode !== '0' && <X size={16} className="text-danger" />}
          {status === 'success' &&
            denied !== 'true' &&
            (exitCode === undefined || exitCode === '0') && (
              <CheckCheck size={16} className="text-success" />
            )}
          {(status === 'error' || denied === 'true') && (
            <X size={16} className="text-danger" />
          )}
        </div>
      </div>
      {status === 'error' && error && (
        <div className="px-4 pb-3 text-xs text-danger break-words font-mono whitespace-pre-wrap">
          {decodeHtmlEntities(error)}
        </div>
      )}
      {type === 'code_execution' && expanded && code && (
        <div className="border-t border-surface-2">
          <CodeBlock className="language-javascript">
            {decodeBase64(code)}
          </CodeBlock>
          {stdout && (
            <div className="border-t border-surface-2">
              <div className="px-4 py-1 text-xs text-fg/50 font-mono bg-surface-2/50">
                stdout
              </div>
              <CodeBlock className="language-text">
                {decodeBase64(stdout)}
              </CodeBlock>
            </div>
          )}
          {stderr && (
            <div className="border-t border-danger">
              <div className="px-4 py-1 text-xs text-danger font-mono bg-danger-soft">
                stderr
              </div>
              <CodeBlock className="language-text">
                {decodeBase64(stderr)}
              </CodeBlock>
            </div>
          )}
        </div>
      )}
    </div>
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
      ToolCall: {
        component: ToolCall,
      },
      SubagentExecution: {
        component: SubagentExecution,
      },
      code: {
        component: ({ className, children }) => {
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
        },
      },
      strong: {
        component: ({ children }) => (
          <strong className="font-bold">{children}</strong>
        ),
      },
      pre: {
        component: ({ children }) => children,
      },
      a: {
        component: (props) => {
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

          // Default link behavior
          return <a {...props} target="_blank" rel="noopener noreferrer" />;
        },
      },
      // Prevent rendering of certain HTML elements for security
      iframe: () => null, // Don't render iframes
      script: () => null, // Don't render scripts
      object: () => null, // Don't render objects
      style: () => null, // Don't render styles
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

  // For showThinking=false, strip think blocks entirely and render as plain markdown
  if (!showThinking) {
    const stripped = removeThinkTags(content);
    if (!stripped || stripped.length === 0) return null;
    return (
      <div className="relative">
        <Markdown className={proseClassName} options={markdownOverrides}>
          {ensureBlockElements(stripped)}
        </Markdown>
      </div>
    );
  }

  // Split content into segments so <think> blocks are extracted before markdown-to-jsx
  // processes them (the library would mis-parse multi-paragraph think blocks as plain text).
  const segments = splitByThinkBlocks(content);

  // Fast path: no think blocks present — render content directly
  if (segments.length === 0) return null;
  if (segments.length === 1 && segments[0].type === 'markdown') {
    return (
      <div className="relative">
        <Markdown className={proseClassName} options={markdownOverrides}>
          {ensureBlockElements(content)}
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
                content={segment.content}
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
            {ensureBlockElements(segment.content)}
          </Markdown>
        );
      })}
    </div>
  );
};

export default MarkdownRenderer;
