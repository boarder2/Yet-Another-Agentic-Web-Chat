import CapabilityCategoryNavigation from '@/components/Capabilities/CapabilityCategoryNavigation';
import CapabilityTableOfContents, {
  type CapabilityTocPage,
} from '@/components/Capabilities/CapabilityTableOfContents';
import type { CapabilityPage } from '@/lib/capabilities/types';

export function CapabilityDocsShell({
  pages,
  children,
}: {
  pages: readonly CapabilityPage[];
  children: React.ReactNode;
}) {
  const navigationPages = pages.map(({ slug, title }) => ({ slug, title }));
  const tocPages: CapabilityTocPage[] = pages.map(({ slug, sections }) => ({
    slug,
    sections: sections.map(({ heading, anchor, level, startLine }) => ({
      heading,
      anchor,
      level,
      startLine,
    })),
  }));

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 pb-24 sm:px-6 lg:px-4">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          YAAWC help
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          Current capability guides, prerequisites, limits, and privacy details.
        </p>
      </header>

      <div className="mb-4 lg:hidden">
        <CapabilityCategoryNavigation pages={navigationPages} mobile />
      </div>

      <div className="flex items-start gap-6">
        <CapabilityCategoryNavigation pages={navigationPages} />

        <section
          id="capability-docs-content"
          className="min-w-0 flex-1 max-w-screen-lg"
        >
          <CapabilityTableOfContents pages={tocPages} mobile />
          {children}
        </section>

        <CapabilityTableOfContents pages={tocPages} />
      </div>
    </div>
  );
}

export default CapabilityDocsShell;
