'use client';

import { ExternalLink, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatTimeDifference } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';
import {
  artifactRawUrl,
  useAllArtifacts,
  type ArtifactListSummary,
} from '@/lib/hooks/api/useArtifacts';

/**
 * No-op catch for the chip click on a workspace chat: the row's workspace ID
 * is the chat's workspace, so a chat-scoped artifact never hits this.
 */
const chipActive = (selected: string[], id: string) => selected.includes(id);
const toggleChip = (
  set: React.Dispatch<React.SetStateAction<string[]>>,
  id: string,
) =>
  set((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
  );

export default function ArtifactBrowser() {
  const router = useRouter();
  const { data: activeWorkspaces = [] } = useWorkspacesList(false);
  const { data: archivedWorkspaces = [] } = useWorkspacesList(true);
  const [selectedWorkspaceFilters, setSelectedWorkspaceFilters] = useState<
    string[]
  >([]);

  const workspaceMap = useMemo(() => {
    const map: Record<
      string,
      { name: string | null; icon: string | null; color: string | null }
    > = {};
    for (const ws of [...activeWorkspaces, ...archivedWorkspaces])
      map[ws.id] = { name: ws.name, icon: ws.icon, color: ws.color };
    return map;
  }, [activeWorkspaces, archivedWorkspaces]);

  const { data: artifacts, isLoading } = useAllArtifacts({
    workspaceIds: selectedWorkspaceFilters,
  });

  const openInNewTab = (a: ArtifactListSummary) =>
    window.open(artifactRawUrl(a.id), '_blank', 'noopener');

  const chatHref = (a: ArtifactListSummary) => {
    if (!a.chatId) return null;
    const thread = a.workspaceId
      ? `/workspaces/${a.workspaceId}/c/${a.chatId}`
      : `/c/${a.chatId}`;
    return `${thread}?artifact=${a.id}`;
  };

  return (
    <div>
      {/* Workspace filter chips */}
      {activeWorkspaces.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedWorkspaceFilters([])}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors whitespace-nowrap',
              selectedWorkspaceFilters.length === 0
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            All
          </button>
          {activeWorkspaces.map((ws) => {
            const c = workspaceColorClasses(ws.color);
            const selected = chipActive(selectedWorkspaceFilters, ws.id);
            return (
              <button
                type="button"
                key={ws.id}
                onClick={() => toggleChip(setSelectedWorkspaceFilters, ws.id)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors whitespace-nowrap',
                  selected
                    ? cn(c.bgTint, c.border, c.text)
                    : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
                )}
              >
                <WorkspaceIcon
                  name={ws.icon}
                  color={ws.color}
                  size={11}
                  applyColor={selected}
                />
                {ws.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => toggleChip(setSelectedWorkspaceFilters, 'none')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors whitespace-nowrap',
              chipActive(selectedWorkspaceFilters, 'none')
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            No workspace
          </button>
        </div>
      )}

      {!isLoading && artifacts && artifacts.length > 0 && (
        <div className="text-xs text-fg/50 mb-2">
          {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}
        </div>
      )}

      {isLoading && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!isLoading && artifacts && artifacts.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <p className="text-fg/70 text-sm">No artifacts yet.</p>
        </div>
      )}

      {artifacts && artifacts.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {artifacts.map((a) => {
            const ws = a.workspaceId ? workspaceMap[a.workspaceId] : null;
            const href = chatHref(a);
            const c = ws ? workspaceColorClasses(ws.color) : null;
            const meta = (
              <span className="block text-xs text-fg/50">
                v{a.latestVersion} · {a.versionCount} version
                {a.versionCount === 1 ? '' : 's'} ·{' '}
                {formatTimeDifference(new Date(), a.updatedAt)} ago
                {a.chatTitle ? ` · ${a.chatTitle}` : ''}
              </span>
            );
            return (
              <div
                key={a.id}
                className="group flex items-center gap-2 py-2 border-b border-surface-2 last:border-b-0"
              >
                {href ? (
                  <button
                    type="button"
                    onClick={() => router.push(href)}
                    className="flex-1 min-w-0 text-left px-1 py-0.5 rounded-control hover:bg-surface-2 transition"
                  >
                    <span className="block text-sm font-medium truncate">
                      {a.title}
                    </span>
                    {meta}
                  </button>
                ) : (
                  <div className="flex-1 min-w-0 text-left px-1 py-0.5">
                    <span className="block text-sm font-medium truncate">
                      {a.title}
                    </span>
                    {meta}
                  </div>
                )}
                {ws ? (
                  <span
                    title={ws.name ?? ''}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                      c!.bgTint,
                      c!.border,
                      c!.text,
                    )}
                  >
                    <WorkspaceIcon
                      name={ws.icon}
                      color={ws.color}
                      size={11}
                      applyColor
                    />
                    {ws.name}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-pill bg-surface border border-surface-2 px-2 py-0.5 text-xs font-medium text-fg/50 whitespace-nowrap">
                    No workspace
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => openInNewTab(a)}
                  title="Open in a new tab"
                  aria-label="Open in a new tab"
                  className="p-1.5 rounded-control hover:bg-surface-2 transition text-fg/60"
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
