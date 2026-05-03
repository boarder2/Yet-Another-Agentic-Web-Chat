'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import WorkspaceIcon from './WorkspaceIcon';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import type { Workspace } from '@/lib/hooks/useWorkspace';

/**
 * Shared workspace header — small "Workspaces" breadcrumb above a prominent
 * icon + name row, optional description, and a divider beneath. Matches the
 * visual language of the global PageHeader so workspace pages feel like the
 * other navigable pages.
 *
 * Used by:
 *   - `WorkspaceShell` (sticky, in document flow)
 *   - `WorkspaceChatHeader` (fixed bar above the chat Navbar)
 */
const WorkspaceDetailHeader = ({
  workspace,
  contentClassName = 'px-4 sm:px-6',
}: {
  workspace: Workspace;
  /** Padding / alignment classes for the inner content. Defaults to `px-4 sm:px-6`. */
  contentClassName?: string;
}) => {
  const c = workspaceColorClasses(workspace.color);

  return (
    <div className="bg-bg">
      <div className={cn('pt-4 flex flex-col', contentClassName)}>
        <Link
          href="/workspaces"
          className="text-xs text-fg/50 hover:text-fg transition w-fit"
        >
          Workspaces
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <Link
            href={`/workspaces/${workspace.id}`}
            className="flex items-center gap-3 min-w-0"
          >
            <span
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-control shrink-0',
                c.bgTint,
              )}
            >
              <WorkspaceIcon
                name={workspace.icon}
                color={workspace.color}
                size={22}
              />
            </span>

            <div className="flex flex-col min-w-0">
              <h1 className="text-2xl font-medium truncate leading-7">
                {workspace.name}
              </h1>
              {workspace.description && (
                <span className="text-xs text-fg/50 truncate leading-4">
                  {workspace.description}
                </span>
              )}
            </div>
            {workspace.archivedAt && (
              <span className="px-2 py-0.5 rounded-pill text-xs bg-surface-2 text-fg/50 shrink-0">
                Archived
              </span>
            )}
          </Link>
        </div>
        <hr className="border-t border-surface-2 my-4 w-full" />
      </div>
    </div>
  );
};

export default WorkspaceDetailHeader;
