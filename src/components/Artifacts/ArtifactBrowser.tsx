'use client';

import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatTimeDifference } from '@/lib/utils';
import {
  ListCount,
  ListEmptyState,
  ListLoading,
  ListRow,
  ListRowAction,
  listRowInteractive,
} from '@/components/ui/List';
import WorkspaceChip from '@/components/Workspaces/WorkspaceChip';
import WorkspaceFilterChips from '@/components/Workspaces/WorkspaceFilterChips';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';
import {
  artifactRawUrl,
  useAllArtifacts,
  type ArtifactListSummary,
} from '@/lib/hooks/api/useArtifacts';

export default function ArtifactBrowser() {
  const { data: activeWorkspaces = [] } = useWorkspacesList(false);
  const { data: archivedWorkspaces = [] } = useWorkspacesList(true);
  const [selectedWorkspaceFilters, setSelectedWorkspaceFilters] = useState<
    string[]
  >([]);

  const workspaceMap = useMemo(() => {
    const map: Record<
      string,
      { name: string; icon: string | null; color: string | null }
    > = {};
    for (const ws of [...activeWorkspaces, ...archivedWorkspaces])
      map[ws.id] = { name: ws.name, icon: ws.icon, color: ws.color };
    return map;
  }, [activeWorkspaces, archivedWorkspaces]);

  const { data: artifacts, isLoading } = useAllArtifacts({
    workspaceIds: selectedWorkspaceFilters,
  });

  const chatHref = (a: ArtifactListSummary) => {
    if (!a.chatId) return undefined;
    const thread = a.workspaceId
      ? `/workspaces/${a.workspaceId}/c/${a.chatId}`
      : `/c/${a.chatId}`;
    return `${thread}?artifact=${a.id}`;
  };

  return (
    <div>
      <WorkspaceFilterChips
        selected={selectedWorkspaceFilters}
        onChange={setSelectedWorkspaceFilters}
      />

      {!isLoading && artifacts && artifacts.length > 0 && (
        <ListCount>
          {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}
        </ListCount>
      )}

      {isLoading && <ListLoading />}

      {!isLoading && artifacts && artifacts.length === 0 && (
        <ListEmptyState>No artifacts yet.</ListEmptyState>
      )}

      {artifacts && artifacts.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {artifacts.map((a) => {
            const ws = a.workspaceId ? workspaceMap[a.workspaceId] : null;
            return (
              <ListRow
                key={a.id}
                href={chatHref(a)}
                title={a.title}
                meta={
                  <>
                    <span>
                      {formatTimeDifference(new Date(), a.updatedAt)} ago
                    </span>
                    <span>v{a.latestVersion}</span>
                    <span>
                      {a.versionCount} version
                      {a.versionCount === 1 ? '' : 's'}
                    </span>
                    {a.chatTitle && (
                      <span className="max-w-[16rem] truncate">
                        {a.chatTitle}
                      </span>
                    )}
                    {ws && a.workspaceId && (
                      <span className={listRowInteractive}>
                        <WorkspaceChip
                          id={a.workspaceId}
                          name={ws.name}
                          icon={ws.icon}
                          color={ws.color}
                          inert
                        />
                      </span>
                    )}
                  </>
                }
                actions={
                  <ListRowAction
                    icon={ExternalLink}
                    label="Open in a new tab"
                    onClick={() =>
                      window.open(artifactRawUrl(a.id), '_blank', 'noopener')
                    }
                  />
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
