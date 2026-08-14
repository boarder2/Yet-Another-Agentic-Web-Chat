'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import ConfirmModal from '@/components/ui/ConfirmModal';
import ArtifactViewer from './ArtifactViewer';
import { WORKSPACE_HEADER_HEIGHT } from '@/components/Workspaces/WorkspaceChatHeader';
import { useArtifact, useDeleteArtifact } from '@/lib/hooks/api/useArtifacts';

/**
 * A workspace document on its own page — where the sidebar sends you when no
 * chat is mounted to host the side panel. Same viewer, with delete in place of
 * the panel's close button.
 */
export default function ArtifactPage({
  workspaceId,
  artifactId,
}: {
  workspaceId: string;
  artifactId: string;
}) {
  const router = useRouter();
  const { data: artifact } = useArtifact(artifactId);
  const del = useDeleteArtifact();
  const [version, setVersion] = useState<number | undefined>();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <ArtifactViewer
        artifactId={artifactId}
        version={version}
        onSelectVersion={(_id, v) => setVersion(v)}
        // Matches the sidebar's own sticky height, so the frame fills exactly
        // the space the workspace header leaves.
        style={{ height: `calc(100vh - ${WORKSPACE_HEADER_HEIGHT}px)` }}
        className="flex min-w-0 flex-col bg-bg"
        title={
          <h1 className="truncate font-medium" data-testid="artifact-title">
            {artifact?.title ?? ''}
          </h1>
        }
        actions={
          <IconButton
            icon={Trash2}
            label="Delete artifact"
            tone="danger"
            onClick={() => setConfirming(true)}
          />
        }
      />

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete artifact"
        body={
          <p>
            Delete <span className="font-medium">{artifact?.title}</span> and
            all {artifact?.versionCount} of its versions? This cannot be undone.
          </p>
        }
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(artifactId, {
            onSuccess: () => {
              setConfirming(false);
              router.replace(`/workspaces/${workspaceId}`);
            },
          })
        }
      />
    </>
  );
}
