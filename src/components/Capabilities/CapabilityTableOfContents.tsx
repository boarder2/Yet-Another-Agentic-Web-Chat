'use client';

import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import {
  capabilitySlugFromPathname,
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
      className={cn('text-sm', !mobile && 'sticky top-6 w-52 shrink-0')}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">
        On this page
      </p>
      <ul className="space-y-1">
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
    <aside className="hidden xl:block">{navigation}</aside>
  );
}

export default function CapabilityTableOfContents({
  pages,
  mobile = false,
}: {
  pages: readonly CapabilityTocPage[];
  mobile?: boolean;
}) {
  const activeSlug = capabilitySlugFromPathname(usePathname());
  const page = pages.find((candidate) => candidate.slug === activeSlug);

  return page ? <TableOfContents page={page} mobile={mobile} /> : null;
}
