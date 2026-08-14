'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useWorkspace } from '@/lib/hooks/api/useWorkspaces';
import { useLocalStorageBoolean } from '@/lib/hooks/useLocalStorage';
import { cn } from '@/lib/utils';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import WorkspaceDetailHeader from './WorkspaceDetailHeader';
import WorkspaceSidebar from './WorkspaceSidebar';
import { ArtifactBridgeProvider } from '@/lib/artifacts/ArtifactBridgeContext';
import { WORKSPACE_HEADER_HEIGHT } from './WorkspaceChatHeader';

/** The expanded sidebar's width (`w-96`). */
const SIDEBAR_WIDTH = 384;
/** Narrowest chat column we leave beside an expanded sidebar — matches what
 *  the `lg` breakpoint itself yields, so only a docked artifact panel (which
 *  the row's width is reserved out of) can push below it. */
const MIN_CONTENT_WIDTH = 560;

export default function WorkspaceShell({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const { data: workspace, isLoading: loading } = useWorkspace(workspaceId);
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageBoolean(
    'workspaceSidebarCollapsed',
    false,
  );
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [cramped, setCramped] = useState(false);

  // The row's width is what's left of `<main>` after the artifact panel is
  // reserved out of it, so opening the panel folds the sidebar down to its
  // rail without touching the stored preference — reopening it is the user's.
  useEffect(() => {
    if (!row) return;
    const observer = new ResizeObserver(([entry]) =>
      setCramped(entry.contentRect.width - SIDEBAR_WIDTH < MIN_CONTENT_WIDTH),
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [row]);

  const collapsed = sidebarCollapsed || cramped;

  if (loading) {
    return (
      <ListLoading layout="page" size={24} className="min-h-screen bg-bg" />
    );
  }

  if (!workspace) {
    return (
      <ListEmptyState
        layout="page"
        icon={FolderOpen}
        title="Workspace not found"
        className="min-h-screen bg-bg"
        action={
          <Link
            href="/workspaces"
            className="border border-transparent text-accent text-sm hover:underline focus-border-neutral"
          >
            Back to workspaces
          </Link>
        }
      />
    );
  }

  return (
    // The sidebar's Artifacts section drives the chat rendered beside it; the
    // two are siblings here, so the bridge has to wrap both.
    <ArtifactBridgeProvider>
      <div className="bg-bg min-h-screen">
        {/* data-sticky-header: overlays the content once scrolled, so scroll
          targets must be offset by its height (see Chat.tsx's open anchor). */}
        <div data-sticky-header className="sticky top-0 z-40">
          <WorkspaceDetailHeader
            workspace={workspace}
            contentClassName="px-4 sm:px-6"
          />
        </div>
        <div ref={setRow} className="flex flex-row">
          <div className="flex-1 min-w-0">{children}</div>
          <div
            className={cn(
              'hidden lg:block shrink-0 border-l border-surface-2 transition-[width] duration-200',
              collapsed ? 'w-16' : 'w-96',
            )}
          >
            <div
              className="sticky overflow-y-auto overflow-x-hidden"
              style={{
                top: WORKSPACE_HEADER_HEIGHT,
                height: `calc(100vh - ${WORKSPACE_HEADER_HEIGHT}px)`,
              }}
            >
              <WorkspaceSidebar
                workspaceId={workspaceId}
                collapsed={collapsed}
                onToggleCollapse={
                  cramped
                    ? undefined
                    : () => setSidebarCollapsed(!sidebarCollapsed)
                }
              />
            </div>
          </div>
        </div>
      </div>
    </ArtifactBridgeProvider>
  );
}
