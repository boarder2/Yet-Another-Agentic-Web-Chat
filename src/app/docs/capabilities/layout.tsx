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
}: {
  children: React.ReactNode;
}) {
  // The `[slug]` segment sits below this layout, so the active page is derived
  // client-side from the pathname rather than passed down from here.
  const result = await getCapabilityDocsCatalog().load();

  return (
    <CapabilityDocsShell pages={result.ok ? result.value : []}>
      {children}
    </CapabilityDocsShell>
  );
}
