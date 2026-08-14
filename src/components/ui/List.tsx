import React from 'react';
import Link from 'next/link';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A navigable `ListRow` stretches its title link across the whole row via an
 * `::after` overlay. Anything else in the row that must stay clickable — a
 * nested chip link, the action cluster — lifts itself above that overlay with
 * this class.
 */
export const listRowInteractive = 'relative z-10';

interface ListRowProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'title'
> {
  /** Makes the whole row a link. Omit for a row that isn't navigable. */
  href?: string;
  /** Rendered before the title (status dot, checkbox). */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** Optional block between title and meta (a search excerpt). */
  body?: React.ReactNode;
  /** Meta segments — separated by gap, never punctuation. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

const ListRow = ({
  href,
  leading,
  title,
  body,
  meta,
  actions,
  className,
  ...props
}: ListRowProps) => (
  <div
    data-list-row
    className={cn(
      'group relative flex items-start gap-2 px-3 py-3',
      href &&
        'transition-colors duration-150 hover:rounded-surface hover:bg-surface',
      className,
    )}
    {...props}
  >
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        {href ? (
          <Link
            href={href}
            data-list-row-title
            className="min-w-0 truncate border border-transparent text-base font-medium after:absolute after:inset-0 focus-border-neutral"
          >
            {title}
          </Link>
        ) : (
          <span
            data-list-row-title
            className="min-w-0 truncate text-base font-medium"
          >
            {title}
          </span>
        )}
      </div>
      {body}
      {meta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
          {meta}
        </div>
      )}
    </div>
    {actions && (
      <div
        className={cn('flex shrink-0 items-center gap-1', listRowInteractive)}
      >
        {actions}
      </div>
    )}
  </div>
);

export type ListStateLayout = 'compact' | 'section' | 'page';
export type ListSpinnerSize = 20 | 24 | 32;

type ListStateProps = {
  layout?: ListStateLayout;
  className?: string;
};

const stateLayoutClasses: Record<ListStateLayout, string> = {
  compact: 'flex items-center justify-center gap-2 py-2',
  section: 'flex min-h-32 items-center justify-center gap-2 px-4 py-8',
  page: 'flex min-h-[30vh] items-center justify-center gap-2 px-4 py-8',
};

interface ListLoadingProps extends ListStateProps {
  /** Accessible status text displayed beside the spinner. */
  status?: React.ReactNode;
  /** Children remain a compatible way to provide status text. */
  children?: React.ReactNode;
  /** Spinner size is restricted to the design-system state sizes. */
  size?: ListSpinnerSize;
  /** Alias for callers that want to name the spinner size explicitly. */
  spinnerSize?: ListSpinnerSize;
}

const ListLoading = ({
  layout = 'page',
  status,
  children,
  size = 32,
  spinnerSize,
  className,
}: ListLoadingProps) => {
  const message = status ?? children;
  const resolvedSize = spinnerSize ?? size;

  return (
    <div
      data-list-state="loading"
      data-list-layout={layout}
      className={cn(stateLayoutClasses[layout], className)}
    >
      <LoaderCircle size={resolvedSize} className="animate-spin text-accent" />
      {message !== undefined && message !== null && (
        <span role="status" className="text-sm text-fg-muted">
          {message}
        </span>
      )}
    </div>
  );
};

interface ListEmptyStateProps extends ListStateProps {
  icon?: LucideIcon;
  title?: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

const ListEmptyState = ({
  layout = 'page',
  icon: Icon,
  title,
  body,
  action,
  children,
  className,
}: ListEmptyStateProps) => {
  const hasStructuredContent =
    Icon !== undefined ||
    title !== undefined ||
    body !== undefined ||
    action !== undefined;

  if (!hasStructuredContent) {
    return (
      <div
        data-list-state="empty"
        data-list-layout={layout}
        className={cn(stateLayoutClasses[layout], className)}
      >
        <p className="text-center text-sm text-fg-muted">{children}</p>
      </div>
    );
  }

  return (
    <div
      data-list-state="empty"
      data-list-layout={layout}
      className={cn(
        stateLayoutClasses[layout],
        layout === 'compact' ? 'text-center' : 'flex-col text-center',
        className,
      )}
    >
      {Icon && (
        <Icon size={layout === 'page' ? 48 : 32} className="text-fg-subtle" />
      )}
      {(title !== undefined ||
        body !== undefined ||
        children !== undefined) && (
        <div className="space-y-1">
          {title !== undefined && (
            <h2 className="text-base font-medium text-fg">{title}</h2>
          )}
          {(body !== undefined || children !== undefined) && (
            <div className="max-w-md text-sm text-fg-muted">
              {body ?? children}
            </div>
          )}
        </div>
      )}
      {action !== undefined && action}
    </div>
  );
};

const ListCount = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2 text-xs text-fg-subtle">{children}</div>
);

export { ListRow, ListLoading, ListEmptyState, ListCount };
