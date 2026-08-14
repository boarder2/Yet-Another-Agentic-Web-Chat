'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  CAPABILITY_DOCS_ROUTE,
  type CapabilityPage,
} from '@/lib/capabilities/types';

type CapabilityNavigationPage = Pick<CapabilityPage, 'slug' | 'title'>;

function pageLabel(page: CapabilityNavigationPage): string {
  return page.slug === 'README' ? 'Overview' : page.title;
}

function slugFromPathname(pathname: string | null): string {
  if (!pathname || pathname === CAPABILITY_DOCS_ROUTE) return 'README';
  const prefix = `${CAPABILITY_DOCS_ROUTE}/`;
  if (!pathname.startsWith(prefix)) return 'README';

  const segment = pathname.slice(prefix.length).split('/')[0];
  try {
    return decodeURIComponent(segment) || 'README';
  } catch {
    return 'README';
  }
}

function pageUrl(page: CapabilityNavigationPage): string {
  return page.slug === 'README'
    ? CAPABILITY_DOCS_ROUTE
    : `${CAPABILITY_DOCS_ROUTE}/${encodeURIComponent(page.slug)}`;
}

export default function CapabilityCategoryNavigation({
  pages,
  currentSlug,
  mobile = false,
}: {
  pages: readonly CapabilityNavigationPage[];
  currentSlug: string;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const activeSlug = pathname ? slugFromPathname(pathname) : currentSlug;

  return (
    <nav
      aria-label="Capability categories"
      className={cn(
        mobile
          ? 'flex gap-1 overflow-x-auto pb-1 lg:hidden'
          : 'hidden w-56 shrink-0 lg:block',
      )}
    >
      {!mobile && (
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-accent">
          Categories
        </p>
      )}
      <div className={cn(mobile ? 'flex gap-1' : 'space-y-1')}>
        {pages.map((page) => {
          const active = page.slug === activeSlug;
          return (
            <Link
              key={page.slug}
              href={pageUrl(page)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'block border border-transparent text-sm transition-colors duration-150 focus-border-neutral',
                mobile
                  ? 'whitespace-nowrap rounded-pill px-3 py-1.5'
                  : 'rounded-surface px-3 py-2',
                active
                  ? 'bg-surface-2 font-medium text-fg'
                  : 'text-fg-muted hover:bg-surface hover:text-fg',
              )}
            >
              {pageLabel(page)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
