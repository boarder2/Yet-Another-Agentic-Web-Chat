'use client';

import { useState } from 'react';
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
  History,
  MessageSquare,
  ChevronRight,
  BookOpen,
  Plug,
} from 'lucide-react';
import { CodeBlock } from '../CodeBlock';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { useMessage } from '@/lib/hooks/api/useMessage';
import { decodeHtmlEntities } from '@/lib/utils/html';
import MarkdownRenderer from '../MarkdownRenderer';

/**
 * ToolCall boolean-ish fields arrive as a real `boolean` from new fenced
 * widgets or the legacy string `"true"` from old `<ToolCall>` markup — both
 * writers only ever set the field when true, so a loose check on either shape
 * is unambiguous.
 */
const isTrue = (v: string | boolean | undefined): boolean =>
  v === true || v === 'true';

type ArgChipProps = {
  children: React.ReactNode;
  wide?: boolean;
  maxWidth?: 'xs' | 'md';
  mono?: boolean;
  bordered?: boolean;
  href?: string;
};

const ArgChip = ({
  children,
  wide = false,
  maxWidth,
  mono = true,
  bordered = false,
  href,
}: ArgChipProps) => {
  const className = cn(
    'ml-2 rounded-control bg-surface-2 px-2 py-0.5 text-sm',
    mono && 'font-mono',
    (wide || maxWidth) && 'truncate',
    wide && !maxWidth && 'max-w-md',
    maxWidth === 'xs' && 'max-w-xs',
    maxWidth === 'md' && 'max-w-md',
    bordered && 'border border-surface-2',
    href && 'text-accent hover:underline',
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }

  return <span className={className}>{children}</span>;
};

type ToolCallSectionProps = {
  children: React.ReactNode;
  border?: 'surface' | 'danger';
  className?: string;
};

const ToolCallSection = ({
  children,
  border = 'surface',
  className,
}: ToolCallSectionProps) => (
  <div
    className={cn(
      'border-t',
      border === 'danger' ? 'border-danger' : 'border-surface-2',
      className,
    )}
  >
    {children}
  </div>
);

// Custom ToolCall component for markdown
export const ToolCall = ({
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
  imageId,
  mcpArgs,
  mcpResult,
  children,
}: {
  type?: string;
  query?: string;
  urls?: string;
  url?: string;
  videoId?: string;
  count?: string | number;
  status?: string; // running | success | error
  error?: string;
  code?: string;
  description?: string;
  exitCode?: string | number;
  stdout?: string;
  stderr?: string;
  timedOut?: string | boolean;
  oomKilled?: string | boolean;
  denied?: string | boolean;
  executionId?: string;
  selectedOptions?: string;
  freeformText?: string;
  skipped?: string | boolean;
  imageId?: string;
  mcpArgs?: string;
  mcpResult?: string;
  children?: React.ReactNode;
}) => {
  const [expanded, setExpanded] = useState(false);

  // MCP tools render with a `mcp__<server>__<tool>` type and surface their
  // calling arguments + response in an expandable section. `mcpArgs`/`mcpResult`
  // arrive as plain text (the legacy tag override base64-decodes before this
  // component ever sees them; new fenced widgets are plain JSON already).
  const isMcp = !!type?.startsWith('mcp__');
  const mcpParts = isMcp ? type!.split('__') : [];
  const mcpServer = isMcp ? (mcpParts[1] ?? '') : '';
  const mcpTool = isMcp ? mcpParts.slice(2).join('__') : '';
  const mcpExpandable = isMcp && !!(mcpArgs || mcpResult);
  const decodedMcpArgs = (() => {
    if (!mcpArgs) return '';
    try {
      return JSON.stringify(JSON.parse(mcpArgs), null, 2);
    } catch {
      return mcpArgs;
    }
  })();
  const decodedMcpResult = mcpResult ?? '';

  const messageId =
    type === 'get_message' && query ? decodeHtmlEntities(query) : '';
  const {
    data: msgData,
    isLoading: msgLoading,
    error: msgError,
  } = useMessage(messageId, type === 'get_message' && expanded && !!messageId);

  const fetchState =
    !expanded || type !== 'get_message'
      ? { status: 'idle' as const }
      : msgLoading
        ? { status: 'loading' as const }
        : msgError
          ? { status: 'error' as const, error: msgError.message }
          : msgData
            ? { status: 'ok' as const, data: msgData }
            : { status: 'idle' as const };

  const getIcon = (toolType: string) => {
    if (toolType?.startsWith('mcp__')) {
      return <Plug size={16} className="text-accent" />;
    }
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
      case 'image_generation':
        return <ImageIcon size={16} className="text-accent" />;
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
      case 'chat_history_search':
        return <History size={16} className="text-accent" />;
      case 'get_message':
        return <MessageSquare size={16} className="text-accent" />;
      case 'search_yaawc_docs':
        return <BookOpen size={16} className="text-accent" />;
      case 'create_artifact':
        return <FilePlus size={16} className="text-accent" />;
      case 'edit_artifact':
        return <FilePen size={16} className="text-accent" />;
      case 'read_artifact':
        return <FileCode size={16} className="text-accent" />;
      default:
        return <Settings size={16} className="text-fg-muted" />;
    }
  };

  const formatToolMessage = () => {
    if (type === 'search' || type === 'web_search') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Web search:</span>
          <ArgChip>{decodeHtmlEntities(query || (children as string))}</ArgChip>
        </>
      );
    }

    if (type === 'file' || type === 'file_search') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>File search:</span>
          <ArgChip>{decodeHtmlEntities(query || (children as string))}</ArgChip>
        </>
      );
    }

    if (
      type === 'url' ||
      type === 'url_fetch' ||
      type === 'url_summarization'
    ) {
      const urlCount = count ? parseInt(String(count)) : 1;
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
          <ArgChip href={decodeHtmlEntities(url)}>
            {decodeHtmlEntities(url)}
          </ArgChip>
        </>
      );
    }

    if (type === 'image' || type === 'image_search') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Image search:</span>
          <ArgChip>{decodeHtmlEntities(query || (children as string))}</ArgChip>
        </>
      );
    }

    if (type === 'image_analysis') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Analyzing image:</span>
          <ArgChip maxWidth="xs">
            {decodeHtmlEntities(url || query || (children as string))}
          </ArgChip>
        </>
      );
    }

    if (type === 'image_generation') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Generating image:</span>
          <ArgChip maxWidth="xs">
            {decodeHtmlEntities(query || (children as string))}
          </ArgChip>
          {status === 'success' && imageId && (
            <div className="mt-2">
              <a
                href={`/api/uploads/images/${imageId}`}
                target="_blank"
                rel="noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local API image with unknown dimensions */}
                <img
                  src={`/api/uploads/images/${imageId}`}
                  alt={decodeHtmlEntities(query || '')}
                  className="max-w-full max-h-96 rounded-control border border-fg/10"
                />
              </a>
            </div>
          )}
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
          {query && <ArgChip wide>{decodeHtmlEntities(query)}</ArgChip>}
        </>
      );
    }

    if (type === 'delete_memory') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Deleting memory:</span>
          {query && <ArgChip wide>{decodeHtmlEntities(query)}</ArgChip>}
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
          {description && <ArgChip wide>{description}</ArgChip>}
          {isTrue(denied) && (
            <span className="ml-2 px-2 py-0.5 bg-danger-soft text-danger rounded-control text-xs">
              Denied
            </span>
          )}
          {isTrue(timedOut) && (
            <span className="ml-2 px-2 py-0.5 bg-danger-soft text-danger rounded-control text-xs">
              Timed out
            </span>
          )}
          {isTrue(oomKilled) && (
            <span className="ml-2 px-2 py-0.5 bg-danger-soft text-danger rounded-control text-xs">
              Out of memory
            </span>
          )}
          {expanded &&
            exitCode !== undefined &&
            !isTrue(denied) &&
            !isTrue(timedOut) &&
            !isTrue(oomKilled) && (
              <span
                className={`ml-2 px-2 py-0.5 rounded-control text-xs ${
                  String(exitCode) === '0'
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
            <ArgChip wide mono={false}>
              {decodedQuery}
            </ArgChip>
          )}
          {isTrue(skipped) && (
            <span className="ml-2 px-2 py-0.5 bg-warning-soft text-warning rounded-control text-xs">
              Skipped
            </span>
          )}
          {isTrue(timedOut) && (
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
            <ArgChip wide mono={false}>
              {decodedFreeformText}
            </ArgChip>
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
          {query && <ArgChip wide>{decodeHtmlEntities(query)}</ArgChip>}
        </>
      );
    }

    if (type === 'workspace_read') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Reading workspace file{query ? ':' : ''}</span>
          {query && <ArgChip wide>{decodeHtmlEntities(query)}</ArgChip>}
        </>
      );
    }

    if (type === 'workspace_edit') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Editing workspace file{query ? ':' : ''}</span>
          {query && <ArgChip wide>{decodeHtmlEntities(query)}</ArgChip>}
        </>
      );
    }

    if (type === 'workspace_create_file') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Creating workspace file{query ? ':' : ''}</span>
          {query && <ArgChip wide>{decodeHtmlEntities(query)}</ArgChip>}
        </>
      );
    }

    if (type === 'chat_history_search') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Searching chat history:</span>
          <ArgChip>{decodeHtmlEntities(query || (children as string))}</ArgChip>
        </>
      );
    }

    if (type === 'get_message') {
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Fetched message</span>
        </>
      );
    }

    if (type === 'search_yaawc_docs') {
      const docsQuery = decodeHtmlEntities(
        query ?? (typeof children === 'string' ? children : ''),
      );
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>Searching YAAWC documentation</span>
          {docsQuery && (
            <ArgChip wide mono={false}>
              {docsQuery}
            </ArgChip>
          )}
        </>
      );
    }

    if (type === 'read_skill') {
      return (
        <>
          <span className="mr-2">
            <BookOpen size={16} />
          </span>
          <span>Loaded skill</span>
          {query && <ArgChip bordered>{query}</ArgChip>}
        </>
      );
    }

    if (type === 'edit_skill') {
      return (
        <>
          <span className="mr-2">
            <BookOpen size={16} />
          </span>
          <span>Edit skill</span>
        </>
      );
    }

    if (
      type === 'create_artifact' ||
      type === 'edit_artifact' ||
      type === 'read_artifact'
    ) {
      const label =
        type === 'create_artifact'
          ? 'Writing artifact'
          : type === 'edit_artifact'
            ? 'Updating artifact'
            : 'Reading artifact';
      return (
        <>
          <span className="mr-2">{getIcon(type)}</span>
          <span>{label}</span>
        </>
      );
    }

    if (isMcp) {
      return (
        <>
          <span className="mr-2">{getIcon(type || 'default')}</span>
          <span>MCP tool:</span>
          <ArgChip bordered>{mcpTool || type}</ArgChip>
          {mcpServer && (
            <span className="ml-1 text-xs text-fg-subtle">on {mcpServer}</span>
          )}
        </>
      );
    }

    // Fallback for unknown tool types
    return (
      <>
        <span className="mr-2">{getIcon(type || 'default')}</span>
        <span>Using tool:</span>
        <ArgChip bordered>{type || 'unknown'}</ArgChip>
      </>
    );
  };

  const isExpandable =
    (type === 'code_execution' && !!code) ||
    type === 'get_message' ||
    mcpExpandable;

  const headerContent = (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {formatToolMessage()}
      </div>
      <div className="flex h-5 items-center gap-2">
        {isExpandable && (
          <ChevronRight
            size={16}
            className={`text-fg-subtle transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
        )}
        {status === 'running' && (
          <LoaderCircle size={16} className="animate-spin text-accent" />
        )}
        {status === 'success' &&
          !isTrue(denied) &&
          exitCode !== undefined &&
          String(exitCode) !== '0' && <X size={16} className="text-danger" />}
        {status === 'success' &&
          !isTrue(denied) &&
          (exitCode === undefined || String(exitCode) === '0') && (
            <CheckCheck size={16} className="text-success" />
          )}
        {(status === 'error' || isTrue(denied)) && (
          <X size={16} className="text-danger" />
        )}
      </div>
    </>
  );

  return (
    <Card data-execution className="my-3 overflow-hidden">
      {isExpandable ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-start justify-between gap-2 border border-transparent px-4 py-3 text-left text-sm font-medium transition-colors duration-150 hover:bg-surface-2/50 focus-border-neutral"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex items-start justify-between gap-2 px-4 py-3 text-sm font-medium">
          {headerContent}
        </div>
      )}
      {status === 'error' && error && (
        <div className="px-4 pb-3 text-xs text-danger break-words font-mono whitespace-pre-wrap">
          {decodeHtmlEntities(error)}
        </div>
      )}
      {type === 'get_message' && expanded && (
        <ToolCallSection className="space-y-3 px-4 py-3 text-sm">
          {fetchState.status === 'loading' && (
            <div className="flex items-center gap-2 text-fg-muted">
              <LoaderCircle size={16} className="animate-spin text-accent" />
              <span>Loading message…</span>
            </div>
          )}
          {fetchState.status === 'error' && (
            <div className="text-danger">{fetchState.error}</div>
          )}
          {fetchState.status === 'ok' && (
            <>
              <div
                className="text-lg font-semibold text-fg truncate"
                title={fetchState.data.chatTitle ?? ''}
              >
                {fetchState.data.chatTitle || '(untitled chat)'}
              </div>
              <a
                href={`/c/${fetchState.data.chatId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline text-xs"
              >
                View chat thread ↗
              </a>
              <MarkdownRenderer content={fetchState.data.content} />
            </>
          )}
        </ToolCallSection>
      )}
      {type === 'code_execution' && expanded && code && (
        <ToolCallSection>
          <CodeBlock className="language-javascript">{code}</CodeBlock>
          {stdout && (
            <ToolCallSection>
              <div className="px-4 py-1 text-xs text-fg-subtle font-mono bg-surface-2/50">
                stdout
              </div>
              <CodeBlock className="language-text">{stdout}</CodeBlock>
            </ToolCallSection>
          )}
          {stderr && (
            <ToolCallSection border="danger">
              <div className="px-4 py-1 text-xs text-danger font-mono bg-danger-soft">
                stderr
              </div>
              <CodeBlock className="language-text">{stderr}</CodeBlock>
            </ToolCallSection>
          )}
        </ToolCallSection>
      )}
      {isMcp && expanded && mcpExpandable && (
        <ToolCallSection>
          {decodedMcpArgs && (
            <div>
              <div className="px-4 py-1 text-xs text-fg-subtle font-mono bg-surface-2/50">
                Arguments
              </div>
              <CodeBlock className="language-json">{decodedMcpArgs}</CodeBlock>
            </div>
          )}
          {decodedMcpResult && (
            <ToolCallSection>
              <div className="px-4 py-1 text-xs text-fg-subtle font-mono bg-surface-2/50">
                Response
              </div>
              <CodeBlock className="language-text">
                {decodedMcpResult}
              </CodeBlock>
            </ToolCallSection>
          )}
        </ToolCallSection>
      )}
    </Card>
  );
};

export default ToolCall;
