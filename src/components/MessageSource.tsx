/* eslint-disable @next/next/no-img-element */
import { Document } from '@langchain/core/documents';
import {
  BookOpen,
  File,
  FileText,
  Microscope,
  Sparkles,
  Zap,
} from 'lucide-react';

interface MessageSourceProps {
  source: Document;
  index?: number;
  style?: React.CSSProperties;
  className?: string;
  oneLiner?: boolean;
}

function isCapabilityDocument(source: Document): boolean {
  return source.metadata.source === 'yaawc_docs';
}

/** Rendered inside the caller's sized pill, which supplies the background. */
function SourceIcon({
  source,
  compact,
}: {
  source: Document;
  compact: boolean;
}) {
  const sourceUrl = String(source.metadata.url ?? '');
  const size = compact ? 14 : 16;

  if (isCapabilityDocument(source)) {
    return <BookOpen size={size} className="text-accent" />;
  }

  if (sourceUrl === 'File') {
    return <File size={size} className="text-fg-muted" />;
  }

  return (
    <img
      src={`https://s2.googleusercontent.com/s2/favicons?domain_url=${sourceUrl}`}
      width={compact ? 20 : 28}
      height={compact ? 20 : 28}
      alt=""
      className={
        compact ? 'h-5 w-5 rounded-surface' : 'h-7 w-7 rounded-surface'
      }
    />
  );
}

const MessageSource = ({
  source,
  index,
  style,
  className,
  oneLiner = false,
}: MessageSourceProps) => {
  const isInternal = isCapabilityDocument(source);
  const sourceUrl = String(source.metadata.url ?? '');
  const linkProps = isInternal
    ? {}
    : { target: '_blank', rel: 'noopener noreferrer' };

  return oneLiner ? (
    <a
      className={`flex flex-row items-center space-x-2 rounded-surface border border-surface-2 bg-surface p-2 font-medium no-underline transition-colors duration-150 hover:bg-surface-2 focus-border-neutral ${className || ''}`}
      href={sourceUrl}
      {...linkProps}
      style={style}
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-pill bg-surface-2">
        <SourceIcon source={source} compact />
      </div>
      <span className="truncate text-xs text-fg-muted">
        {source.metadata.title ||
          (isInternal ? 'YAAWC documentation' : sourceUrl)}
      </span>
    </a>
  ) : (
    <a
      className={`flex flex-row space-x-3 rounded-surface border border-surface-2 bg-surface p-4 font-medium no-underline transition-colors duration-150 hover:bg-surface-2 focus-border-neutral ${className || ''}`}
      href={sourceUrl}
      {...linkProps}
      style={style}
    >
      <div className="flex shrink-0 flex-col items-center space-y-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-pill bg-surface-2">
          <SourceIcon source={source} compact={false} />
        </div>
        <div className="flex flex-row items-center space-x-1 text-xs text-fg-subtle">
          {typeof index === 'number' && (
            <span className="font-semibold">{index + 1}</span>
          )}
          {source.metadata.processingType === 'preview-only' && (
            <span title="Partial content analyzed" className="inline-flex">
              <Zap size={12} className="text-fg-subtle" />
            </span>
          )}
          {source.metadata.processingType === 'full-content' && (
            <span title="Full content analyzed" className="inline-flex">
              <Microscope size={12} className="text-fg-subtle" />
            </span>
          )}
          {source.metadata.processingType === 'url-direct-content' && (
            <span title="Direct URL content" className="inline-flex">
              <FileText size={12} className="text-fg-subtle" />
            </span>
          )}
          {source.metadata.processingType === 'url-full-content' && (
            <span title="Full URL content" className="inline-flex">
              <FileText size={12} className="text-fg-subtle" />
            </span>
          )}
          {source.metadata.processingType === 'url-content-extraction' && (
            <span title="Summarized URL content" className="inline-flex">
              <Sparkles size={12} className="text-fg-subtle" />
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col space-y-2">
        <h3 className="text-sm font-semibold leading-tight text-fg">
          {source.metadata.title ||
            (isInternal ? 'YAAWC documentation' : sourceUrl)}
        </h3>

        <p className="text-xs text-fg-subtle">
          {isInternal ? sourceUrl : sourceUrl.replace(/.+\/\/|www\.|\..+/g, '')}
        </p>

        <p
          className="overflow-hidden text-xs leading-relaxed text-fg-muted"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {source.metadata.processingType === 'preview-only' &&
          source.metadata.snippet
            ? source.metadata.snippet
            : source.pageContent?.length > 250
              ? source.pageContent.slice(0, 250) + '...'
              : source.pageContent || 'No preview available'}
        </p>
      </div>
    </a>
  );
};

export default MessageSource;
