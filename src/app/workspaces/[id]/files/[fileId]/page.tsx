import { getFile } from '@/lib/workspaces/files';
import { notFound } from 'next/navigation';
import FileViewer from '@/components/Workspaces/FileViewer';

export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; fileId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id, fileId } = await params;
  const { edit } = await searchParams;
  const file = await getFile(id, fileId);
  if (!file) notFound();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <FileViewer
        workspaceId={id}
        fileId={fileId}
        startEditing={edit === '1'}
      />
    </div>
  );
}
