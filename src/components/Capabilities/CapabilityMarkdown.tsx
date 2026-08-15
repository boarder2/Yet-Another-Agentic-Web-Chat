'use client';

import Markdown, { MarkdownToJSX } from 'markdown-to-jsx';
import type { ComponentProps, ReactNode } from 'react';
import { CodeBlock } from '@/components/CodeBlock';
import { cn } from '@/lib/utils';
import { createHeadingAnchor } from '@/lib/capabilities/search';
import {
  CAPABILITY_DOC_FILENAMES,
  capabilityPageUrl,
  isExternalHref,
  type CapabilitySection,
} from '@/lib/capabilities/types';

const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

type HeadingProps = { children?: ReactNode };

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return '';
}

function codeContent(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(codeContent).join('');
  return node == null ? '' : String(node);
}

function createHeadingRenderer(sections: readonly CapabilitySection[]) {
  let headingIndex = 0;

  return function CapabilityHeading({ children }: HeadingProps) {
    const section = sections[headingIndex++];
    const fallbackHeading = textContent(children) || 'Section';
    const level = section?.level ?? 2;
    const Tag = headingTags[Math.min(Math.max(level, 1), 6) - 1];
    const anchor = section?.anchor ?? createHeadingAnchor(fallbackHeading);
    const className =
      level === 1
        ? 'scroll-mt-6 text-3xl font-semibold tracking-tight text-fg'
        : level === 2
          ? 'scroll-mt-6 text-2xl font-semibold text-fg'
          : 'scroll-mt-6 text-xl font-semibold text-fg';

    return (
      <Tag id={anchor} className={className}>
        {children}
      </Tag>
    );
  };
}

const CapabilityCode = ({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) => {
  const content = codeContent(children);
  if (className || content.includes('\n')) {
    return <CodeBlock className={className}>{content}</CodeBlock>;
  }
  return (
    <code className="rounded-control bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-fg before:content-none after:content-none">
      {children}
    </code>
  );
};

const TableElement = ({ children, className }: ComponentProps<'table'>) => (
  <div className="my-4 max-w-full overflow-x-auto rounded-surface border border-surface-2">
    <table
      className={cn('w-full min-w-max border-collapse text-sm', className)}
    >
      {children}
    </table>
  </div>
);

const TableHead = ({ children }: ComponentProps<'thead'>) => (
  <thead className="bg-surface-2 text-left text-fg">{children}</thead>
);

const TableRow = ({ children }: ComponentProps<'tr'>) => (
  <tr className="border-b border-surface-2 last:border-b-0">{children}</tr>
);

const TableHeaderCell = ({ children }: ComponentProps<'th'>) => (
  <th className="px-3 py-2 font-semibold text-fg">{children}</th>
);

const TableCell = ({ children }: ComponentProps<'td'>) => (
  <td className="px-3 py-2 align-top text-fg-muted">{children}</td>
);

const PreElement = ({ children }: { children?: ReactNode }) => <>{children}</>;
const NullElement = () => null;

function capabilityFilenameFromLink(pathname: string): string | null {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const filename = decodedPath.split('/').pop();
  return filename &&
    CAPABILITY_DOC_FILENAMES.includes(
      filename as (typeof CAPABILITY_DOC_FILENAMES)[number],
    )
    ? filename
    : null;
}

function normalizeCapabilityLink(rawHref: string): string {
  if (/^(?:javascript|data|vbscript):/i.test(rawHref.trim())) return '';
  if (!rawHref || rawHref.startsWith('#')) return rawHref;
  if (isExternalHref(rawHref)) return rawHref;

  const hashIndex = rawHref.indexOf('#');
  const pathname = hashIndex === -1 ? rawHref : rawHref.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : rawHref.slice(hashIndex + 1);
  const filename = capabilityFilenameFromLink(pathname);
  if (!filename) return rawHref;

  const slug = filename.slice(0, -'.md'.length);
  if (!fragment) return capabilityPageUrl(slug);

  let decodedFragment = fragment;
  try {
    decodedFragment = decodeURIComponent(fragment);
  } catch {
    // Keep the source fragment if it is malformed; the page link remains safe.
  }
  return capabilityPageUrl(slug, { anchor: decodedFragment });
}

const CapabilityLink = ({ href, children }: ComponentProps<'a'>) => {
  const resolvedHref = normalizeCapabilityLink(href ?? '');
  if (!resolvedHref) return <span>{children}</span>;
  const isExternal = isExternalHref(resolvedHref);

  return (
    <a
      href={resolvedHref}
      className="text-accent underline decoration-accent-border underline-offset-2 hover:text-accent-700"
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  );
};

export function CapabilityMarkdown({
  markdown,
  sections,
  className,
}: {
  markdown: string;
  sections: readonly CapabilitySection[];
  className?: string;
}) {
  const Heading = createHeadingRenderer(sections);
  const markdownOverrides: MarkdownToJSX.Options = {
    disableParsingRawHTML: true,
    overrides: {
      h1: { component: Heading },
      h2: { component: Heading },
      h3: { component: Heading },
      h4: { component: Heading },
      h5: { component: Heading },
      h6: { component: Heading },
      code: { component: CapabilityCode },
      pre: { component: PreElement },
      a: { component: CapabilityLink },
      table: { component: TableElement },
      thead: { component: TableHead },
      tr: { component: TableRow },
      th: { component: TableHeaderCell },
      td: { component: TableCell },
      iframe: NullElement,
      script: NullElement,
      object: NullElement,
      embed: NullElement,
      style: NullElement,
      form: NullElement,
      input: NullElement,
      button: NullElement,
      img: NullElement,
      video: NullElement,
      audio: NullElement,
      source: NullElement,
    },
  };

  return (
    <>
      <Markdown
        className={cn(
          'prose max-w-none break-words prose-headings:mb-3 prose-headings:mt-6 prose-headings:leading-tight prose-p:leading-relaxed prose-p:text-fg prose-li:text-fg prose-strong:text-fg prose-a:no-underline prose-code:before:content-none prose-code:after:content-none',
          'prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-blockquote:border-accent prose-blockquote:text-fg-muted',
          'prose-pre:m-0 prose-pre:bg-transparent prose-table:my-0',
          className,
        )}
        options={markdownOverrides}
      >
        {markdown}
      </Markdown>
      <div aria-hidden="true" className="h-[calc(100svh-1.5rem)]" />
    </>
  );
}

export default CapabilityMarkdown;
