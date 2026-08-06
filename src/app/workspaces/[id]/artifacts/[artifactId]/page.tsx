import { notFound } from 'next/navigation';
import { getArtifact } from '@/lib/artifacts/service';
import ArtifactPage from '@/components/Artifacts/ArtifactPage';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; artifactId: string }>;
}) {
  const { id, artifactId } = await params;
  // Scoped server-side: a document belonging to another workspace is a 404 here,
  // not a page that happens to render someone else's content.
  const artifact = getArtifact(artifactId);
  if (!artifact || artifact.workspaceId !== id) notFound();
  return <ArtifactPage workspaceId={id} artifactId={artifactId} />;
}
