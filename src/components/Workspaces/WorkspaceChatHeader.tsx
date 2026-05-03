'use client';

import { useWorkspace } from '@/lib/hooks/useWorkspace';
import { useLocalStorageBoolean } from '@/lib/hooks/useLocalStorage';
import { cn } from '@/lib/utils';
import WorkspaceDetailHeader from './WorkspaceDetailHeader';

/**
 * Height in pixels of this fixed bar. Used by ChatWindow to offset the
 * Navbar and workspace content sidebar so they stack correctly.
 *
 * Breakdown: pt-4 (16) + breadcrumb text-xs (16) + mt-1 (4) + h-9 chip row (36)
 *          + my-4 above hr (16) + hr (1) + my-4 below hr (16) = 105px.
 */
export const WORKSPACE_HEADER_HEIGHT = 105;

/**
 * Fixed workspace context header rendered above the chat Navbar when a chat
 * is scoped to a workspace. Wraps `WorkspaceDetailHeader` with fixed
 * positioning so it sits at the very top of the viewport.
 */
const WorkspaceChatHeader = ({ workspaceId }: { workspaceId: string }) => {
  const { workspace } = useWorkspace(workspaceId);
  const [sidebarCollapsed] = useLocalStorageBoolean(
    'workspaceSidebarCollapsed',
    false,
  );

  if (!workspace) return null;

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-40',
        sidebarCollapsed ? 'lg:right-10' : 'lg:right-96',
      )}
    >
      <WorkspaceDetailHeader
        workspace={workspace}
        contentClassName="px-4 sm:px-6 lg:pl-26 lg:pr-8"
      />
    </div>
  );
};

export default WorkspaceChatHeader;
