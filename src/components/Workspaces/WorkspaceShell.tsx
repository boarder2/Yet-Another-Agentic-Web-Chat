'use client';

import Link from 'next/link';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { useWorkspace } from '@/lib/hooks/useWorkspace';
import { useLocalStorageBoolean } from '@/lib/hooks/useLocalStorage';
import { cn } from '@/lib/utils';
import WorkspaceDetailHeader from './WorkspaceDetailHeader';
import WorkspaceSidebar from './WorkspaceSidebar';
import { WORKSPACE_HEADER_HEIGHT } from './WorkspaceChatHeader';

export default function WorkspaceShell({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const { workspace, loading } = useWorkspace(workspaceId);
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageBoolean(
    'workspaceSidebarCollapsed',
    false,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <LoaderCircle size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg gap-4">
        <FolderOpen size={48} className="text-fg/20" />
        <h2 className="text-lg font-medium text-fg/60">Workspace not found</h2>
        <Link
          href="/workspaces"
          className="text-accent text-sm hover:underline"
        >
          Back to workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-bg min-h-screen">
      <div className="sticky top-0 z-40">
        <WorkspaceDetailHeader
          workspace={workspace}
          contentClassName="px-4 sm:px-6"
        />
      </div>
      <div className="flex flex-row">
        <div className="flex-1 min-w-0">{children}</div>
        <div
          className={cn(
            'hidden lg:block shrink-0 border-l border-surface-2 transition-all duration-200',
            sidebarCollapsed ? 'w-16' : 'w-96',
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
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
