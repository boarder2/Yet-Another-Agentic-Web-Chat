'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
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
          <Button
            size="sm"
            variant="ghost"
            aria-label="Delete artifact"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={16} />
          </Button>
        }
      />

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete artifact"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Delete <span className="font-medium">{artifact?.title}</span> and
            all {artifact?.versionCount} of its versions? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() =>
                del.mutate(artifactId, {
                  onSuccess: () => router.replace(`/workspaces/${workspaceId}`),
                })
              }
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
