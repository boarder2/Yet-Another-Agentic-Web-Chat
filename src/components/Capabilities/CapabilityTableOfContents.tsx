'use client';

import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import {
  CAPABILITY_DOCS_ROUTE,
  type CapabilitySection,
} from '@/lib/capabilities/types';

type CapabilityTocSection = Pick<
  CapabilitySection,
  'heading' | 'anchor' | 'level' | 'startLine'
>;

export type CapabilityTocPage = {
  slug: string;
  sections: readonly CapabilityTocSection[];
};

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

function TableOfContents({
  page,
  mobile,
}: {
  page: CapabilityTocPage;
  mobile: boolean;
}) {
  const sections = page.sections.filter((section) => section.level > 1);
  if (sections.length === 0) return null;

  const navigation = (
    <nav
      aria-label="On this page"
      className={cn(
        'text-sm',
        !mobile && 'flex max-h-[calc(100svh-1.5rem)] w-52 shrink-0 flex-col',
      )}
    >
      <p className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-accent">
        On this page
      </p>
      <ul className={cn('space-y-1', !mobile && 'min-h-0 overflow-y-auto')}>
        {sections.map((section) => (
          <li key={`${section.anchor}-${section.startLine}`}>
            <a
              href={`#${encodeURIComponent(section.anchor)}`}
              className={cn(
                'block rounded-control border border-transparent px-2 py-1 text-fg-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-border-neutral',
                section.level >= 3 && 'ml-3 text-xs',
              )}
            >
              {section.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );

  return mobile ? (
    <Card className="mb-6 p-4 xl:hidden">{navigation}</Card>
  ) : (
    <aside className="hidden xl:sticky xl:top-6 xl:block">{navigation}</aside>
  );
}

export default function CapabilityTableOfContents({
  pages,
  currentSlug,
  mobile = false,
}: {
  pages: readonly CapabilityTocPage[];
  currentSlug: string;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const activeSlug = pathname ? slugFromPathname(pathname) : currentSlug;
  const page = pages.find((candidate) => candidate.slug === activeSlug);

  return page ? <TableOfContents page={page} mobile={mobile} /> : null;
}
