'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  capabilityPageUrl,
  capabilitySlugFromPathname,
  type CapabilityPage,
} from '@/lib/capabilities/types';

type CapabilityNavigationPage = Pick<CapabilityPage, 'slug' | 'title'>;

function pageLabel(page: CapabilityNavigationPage): string {
  return page.slug === 'README' ? 'Overview' : page.title;
}

export default function CapabilityCategoryNavigation({
  pages,
  mobile = false,
}: {
  pages: readonly CapabilityNavigationPage[];
  mobile?: boolean;
}) {
  const activeSlug = capabilitySlugFromPathname(usePathname());

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
              href={capabilityPageUrl(page)}
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
