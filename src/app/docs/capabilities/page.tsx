import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CapabilityMarkdown from '@/components/Capabilities/CapabilityMarkdown';
import { getCapabilityDocsCatalog } from '@/lib/capabilities/catalog';

export const metadata: Metadata = {
  title: 'YAAWC capabilities - YAAWC',
};

export default async function CapabilityDocsIndexPage() {
  const result = await getCapabilityDocsCatalog().getPage('README');
  if (!result.ok) notFound();

  return (
    <CapabilityMarkdown
      markdown={result.value.markdown}
      sections={result.value.sections}
    />
  );
}
