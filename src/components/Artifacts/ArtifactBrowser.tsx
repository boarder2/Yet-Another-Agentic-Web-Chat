'use client';

import { ExternalLink } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo, useState, type KeyboardEvent } from 'react';
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
import { formatTimeDifference } from '@/lib/utils';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';
import {
  artifactRawUrl,
  useAllArtifacts,
  type HistoryImageItem,
  type HistoryItem,
  type HistoryPageItem,
} from '@/lib/hooks/api/useArtifacts';
import ArtifactTypeFilter, {
  ARTIFACT_TYPES,
  type ArtifactType,
} from './ArtifactTypeFilter';
import GeneratedImageHistoryCard, {
  GeneratedImageHistoryMetadata,
} from './GeneratedImageHistoryCard';
import GeneratedImagePreview from './GeneratedImagePreview';

function readArtifactType(value: string | null): ArtifactType {
  return value && (ARTIFACT_TYPES as readonly string[]).includes(value)
    ? (value as ArtifactType)
    : 'all';
}

export default function ArtifactBrowser() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: activeWorkspaces = [] } = useWorkspacesList(false);
  const { data: archivedWorkspaces = [] } = useWorkspacesList(true);
  const [selectedWorkspaceFilters, setSelectedWorkspaceFilters] = useState<
    string[]
  >([]);
  const [selectedImage, setSelectedImage] = useState<HistoryImageItem | null>(
    null,
  );

  const selectedType = readArtifactType(searchParams.get('type'));

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
    type: selectedType,
  });

  const selectType = (type: ArtifactType) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', type);
    window.history.pushState(null, '', `${pathname}?${params.toString()}`);
  };

  const chatHref = (a: HistoryPageItem) => {
    if (!a.chatId) return undefined;
    const thread = a.workspaceId
      ? `/workspaces/${a.workspaceId}/c/${a.chatId}`
      : `/c/${a.chatId}`;
    return `${thread}?artifact=${a.id}`;
  };

  const handleImageKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    image: HistoryImageItem,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setSelectedImage(image);
  };

  const itemName =
    selectedType === 'pages'
      ? 'page'
      : selectedType === 'images'
        ? 'image'
        : 'artifact';

  return (
    <div>
      <ArtifactTypeFilter value={selectedType} onChange={selectType} />
      <WorkspaceFilterChips
        selected={selectedWorkspaceFilters}
        onChange={setSelectedWorkspaceFilters}
      />

      {!isLoading && artifacts && artifacts.length > 0 && (
        <ListCount>
          {artifacts.length} {itemName}
          {artifacts.length === 1 ? '' : 's'}
        </ListCount>
      )}

      {isLoading && <ListLoading layout="page" size={32} />}

      {!isLoading && artifacts && artifacts.length === 0 && (
        <ListEmptyState layout="page">
          {selectedType === 'all'
            ? 'No artifacts yet.'
            : `No ${itemName}s yet.`}
        </ListEmptyState>
      )}

      {artifacts && artifacts.length > 0 && (
        <div
          data-testid={
            selectedType === 'images' ? 'generated-image-gallery' : undefined
          }
          className={
            selectedType === 'images'
              ? 'grid grid-cols-1 gap-4 pb-20 md:grid-cols-2 lg:grid-cols-3 lg:pb-2'
              : 'flex flex-col pb-20 lg:pb-2'
          }
        >
          {artifacts.map((a: HistoryItem) => {
            const ws = a.workspaceId ? workspaceMap[a.workspaceId] : null;

            if (a.type === 'image') {
              if (selectedType === 'images') {
                return (
                  <GeneratedImageHistoryCard
                    key={`${a.type}:${a.id}`}
                    image={a}
                    workspace={ws}
                    onPreview={setSelectedImage}
                  />
                );
              }

              return (
                <ListRow
                  key={`${a.type}:${a.id}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Preview ${a.title}`}
                  className="cursor-pointer border border-transparent transition-colors duration-150 hover:bg-surface-2 focus-border-neutral"
                  onClick={() => setSelectedImage(a)}
                  onKeyDown={(event) => handleImageKeyDown(event, a)}
                  leading={
                    <span className="h-14 w-14 shrink-0 overflow-hidden rounded-control border border-surface-2 bg-well">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.imageUrl}
                        alt={a.title}
                        data-testid="generated-image-thumbnail"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </span>
                  }
                  title={a.title}
                  meta={
                    <GeneratedImageHistoryMetadata image={a} workspace={ws} />
                  }
                />
              );
            }

            return (
              <ListRow
                key={`${a.type}:${a.id}`}
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

      <GeneratedImagePreview
        image={selectedImage}
        workspace={
          selectedImage?.workspaceId
            ? workspaceMap[selectedImage.workspaceId]
            : null
        }
        onClose={() => setSelectedImage(null)}
      />
    </div>
  );
}
