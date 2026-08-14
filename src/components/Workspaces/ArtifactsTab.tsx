'use client';

import { useState } from 'react';
import { AtSign, ExternalLink, Trash2 } from 'lucide-react';
import { formatTimeDifference } from '@/lib/utils';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import {
  useDeleteArtifact,
  useWorkspaceArtifacts,
  type ArtifactSummary,
} from '@/lib/hooks/api/useArtifacts';
import { useArtifactBridge } from '@/lib/artifacts/ArtifactBridgeContext';

/**
 * The workspace's artifacts. Opening one prefers the chat's side panel and
 * falls back to the artifact's own page when no chat is mounted — see
 * `ArtifactBridgeProvider`.
 */
export default function ArtifactsTab({ workspaceId }: { workspaceId: string }) {
  const { data: artifacts, isLoading } = useWorkspaceArtifacts(workspaceId);
  const bridge = useArtifactBridge();
  const del = useDeleteArtifact();
  const [pendingDelete, setPendingDelete] = useState<ArtifactSummary | null>(
    null,
  );

  if (isLoading) return <ListLoading layout="compact" size={20} />;
  if (!artifacts?.length) {
    return (
      <ListEmptyState
        layout="compact"
        body="No artifacts yet. Ask a chat in this workspace to build one."
      />
    );
  }

  const open = (id: string) => {
    if (bridge?.openArtifact) bridge.openArtifact(id);
    else
      window.open(
        `/workspaces/${workspaceId}/artifacts/${id}`,
        '_blank',
        'noopener',
      );
  };

  return (
    <>
      <ul className="space-y-1">
        {artifacts.map((a) => (
          <li
            key={a.id}
            className="group flex items-center gap-1 rounded-control hover:bg-surface-2 transition-colors duration-150"
          >
            <button
              type="button"
              onClick={() => open(a.id)}
              className="flex-1 min-w-0 border border-transparent text-left px-2 py-1.5 focus-border-neutral"
            >
              <span className="block text-sm truncate">{a.title}</span>
              <span className="block text-xs text-fg-subtle">
                v{a.latestVersion} ·{' '}
                {formatTimeDifference(new Date(), a.updatedAt)} ago
              </span>
            </button>
            <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 pr-1">
              {bridge?.insertMention && (
                <IconButton
                  icon={AtSign}
                  label="Mention in the composer"
                  onClick={() => bridge.insertMention?.(a.id, a.title)}
                />
              )}
              <IconButton
                href={`/workspaces/${workspaceId}/artifacts/${a.id}`}
                icon={ExternalLink}
                label="Open in a new tab"
                target="_blank"
                rel="noopener noreferrer"
              />
              <IconButton
                icon={Trash2}
                label="Delete artifact"
                tone="danger"
                onClick={() => setPendingDelete(a)}
              />
            </div>
          </li>
        ))}
      </ul>

      <ConfirmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete artifact"
        body={
          <p>
            Delete <span className="font-medium">{pendingDelete?.title}</span>{' '}
            and all {pendingDelete?.versionCount} of its versions? This cannot
            be undone.
          </p>
        }
        loading={del.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          del.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
          });
        }}
      />
    </>
  );
}
