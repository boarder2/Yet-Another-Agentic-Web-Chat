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

export const listRowActionClasses = (danger?: boolean) =>
  cn(
    'p-1.5 rounded-control text-fg/60 transition-colors duration-150',
    'hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed',
    danger ? 'hover:text-danger' : 'hover:text-fg',
  );

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
            className="min-w-0 truncate text-base font-medium after:absolute after:inset-0"
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg/60">
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

interface ListRowActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  danger?: boolean;
  loading?: boolean;
}

const ListRowAction = ({
  icon: Icon,
  label,
  danger,
  loading,
  className,
  disabled,
  ...props
}: ListRowActionProps) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    disabled={disabled || loading}
    className={cn(listRowActionClasses(danger), className)}
    {...props}
  >
    {loading ? (
      <LoaderCircle size={15} className="animate-spin" />
    ) : (
      <Icon size={15} />
    )}
  </button>
);

const ListLoading = () => (
  <div className="flex min-h-[30vh] items-center justify-center">
    <LoaderCircle size={32} className="animate-spin text-accent" />
  </div>
);

const ListEmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-[30vh] items-center justify-center">
    <p className="text-center text-sm text-fg/70">{children}</p>
  </div>
);

const ListCount = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2 text-xs text-fg/50">{children}</div>
);

export { ListRow, ListRowAction, ListLoading, ListEmptyState, ListCount };
