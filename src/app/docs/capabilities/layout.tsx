import type { Metadata } from 'next';
import CapabilityDocsShell from '@/components/Capabilities/CapabilityDocsShell';
import { getCapabilityDocsCatalog } from '@/lib/capabilities/catalog';

export const metadata: Metadata = {
  title: 'Help & capabilities - YAAWC',
  description:
    'Current YAAWC capability guides, prerequisites, limits, and privacy details.',
};

export default async function CapabilityDocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug?: string }>;
}) {
  const { slug } = await params;
  const result = await getCapabilityDocsCatalog().load();

  return (
    <CapabilityDocsShell
      pages={result.ok ? result.value : []}
      currentSlug={slug ?? 'README'}
    >
      {children}
    </CapabilityDocsShell>
  );
}
