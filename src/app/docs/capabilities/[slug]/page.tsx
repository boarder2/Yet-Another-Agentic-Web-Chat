import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import CapabilityMarkdown from '@/components/Capabilities/CapabilityMarkdown';
import { getCapabilityDocsCatalog } from '@/lib/capabilities/catalog';
import { CAPABILITY_DOCS_ROUTE } from '@/lib/capabilities/types';

export const dynamicParams = false;

export async function generateStaticParams() {
  const result = await getCapabilityDocsCatalog().load();
  if (!result.ok) return [];
  return result.value
    .filter((page) => page.slug !== 'README')
    .map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCapabilityDocsCatalog().getPage(slug);
  if (!result.ok) return { title: 'Not found - YAAWC' };
  return {
    title: `${result.value.title} - YAAWC`,
    description: `YAAWC capability guide: ${result.value.title}.`,
  };
}

export default async function CapabilityDocsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === 'README') redirect(CAPABILITY_DOCS_ROUTE);

  const result = await getCapabilityDocsCatalog().getPage(slug);
  if (!result.ok) notFound();

  return (
    <CapabilityMarkdown
      markdown={result.value.markdown}
      sections={result.value.sections}
    />
  );
}
