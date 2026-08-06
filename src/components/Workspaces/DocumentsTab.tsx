'use client';

import { useState } from 'react';
import { AtSign, ExternalLink, Trash2 } from 'lucide-react';
import { formatTimeDifference } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import {
  useDeleteArtifact,
  useWorkspaceArtifacts,
  type ArtifactSummary,
} from '@/lib/hooks/api/useArtifacts';
import { useArtifactBridge } from '@/lib/artifacts/ArtifactBridgeContext';

/**
 * The workspace's documents. Opening one prefers the chat's side panel and
 * falls back to the document's own page when no chat is mounted — see
 * `ArtifactBridgeProvider`.
 */
export default function DocumentsTab({ workspaceId }: { workspaceId: string }) {
  const { data: artifacts, isLoading } = useWorkspaceArtifacts(workspaceId);
  const bridge = useArtifactBridge();
  const del = useDeleteArtifact();
  const [pendingDelete, setPendingDelete] = useState<ArtifactSummary | null>(
    null,
  );

  if (isLoading) return <p className="text-xs text-fg/50">Loading…</p>;
  if (!artifacts?.length) {
    return (
      <p className="text-xs text-fg/50">
        No documents yet. Ask a chat in this workspace to build one.
      </p>
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
            className="group flex items-center gap-1 rounded-control hover:bg-surface-2 transition"
          >
            <button
              type="button"
              onClick={() => open(a.id)}
              className="flex-1 min-w-0 text-left px-2 py-1.5"
            >
              <span className="block text-sm truncate">{a.title}</span>
              <span className="block text-xs text-fg/50">
                v{a.latestVersion} ·{' '}
                {formatTimeDifference(new Date(), a.updatedAt)} ago
              </span>
            </button>
            <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pr-1">
              {bridge?.insertMention && (
                <button
                  type="button"
                  onClick={() => bridge.insertMention?.(a.id, a.title)}
                  className="p-1.5 rounded-control hover:bg-surface transition text-fg/60"
                  title="Mention in the composer"
                >
                  <AtSign size={14} />
                </button>
              )}
              <a
                href={`/workspaces/${workspaceId}/artifacts/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-control hover:bg-surface transition text-fg/60"
                title="Open in a new tab"
              >
                <ExternalLink size={14} />
              </a>
              <button
                type="button"
                onClick={() => setPendingDelete(a)}
                className="p-1.5 rounded-control hover:bg-surface transition text-fg/60 hover:text-danger"
                title="Delete document"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete document"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-fg/70">
            Delete <span className="font-medium">{pendingDelete?.title}</span>{' '}
            and all {pendingDelete?.versionCount} of its versions? This cannot
            be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() =>
                pendingDelete &&
                del.mutate(pendingDelete.id, {
                  onSuccess: () => setPendingDelete(null),
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
