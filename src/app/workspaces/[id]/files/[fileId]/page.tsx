import { getFile } from '@/lib/workspaces/files';
import { notFound } from 'next/navigation';
import FileViewer from '@/components/Workspaces/FileViewer';

export default async function FilePage({
  params,
}: {
  params: Promise<{ id: string; fileId: string }>;
}) {
  const { id, fileId } = await params;
  const file = await getFile(id, fileId);
  if (!file) notFound();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <FileViewer workspaceId={id} fileId={fileId} />
    </div>
  );
}
