'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  instructions: string | null;
  sourceUrls?: string[];
  autoMemoryEnabled?: 0 | 1 | null;
  autoAcceptFileEdits?: 0 | 1;
  archivedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const EVENT = 'workspace-updated';

export function notifyWorkspaceUpdated(workspaceId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { workspaceId } }));
}

export function useWorkspace(workspaceId: string | null | undefined) {
  // Track the loaded id alongside workspace so loading is derivable without
  // a second setState call.
  const [loaded, setLoaded] = useState<{
    id: string;
    workspace: Workspace | null;
  } | null>(null);
  const loading = !!workspaceId && loaded?.id !== workspaceId;
  const workspace =
    workspaceId && loaded?.id === workspaceId ? loaded.workspace : null;

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    let next: Workspace | null = null;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        next = data.workspace ?? null;
      }
    } catch {
      // ignore
    }
    setLoaded({ id: workspaceId, workspace: next });
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    // refresh's setState fires after an awaited fetch, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ workspaceId: string }>).detail;
      if (detail?.workspaceId === workspaceId) refresh();
    };
    window.addEventListener(EVENT, handler);
    return () => {
      window.removeEventListener(EVENT, handler);
    };
  }, [workspaceId, refresh]);

  return { workspace, loading, refresh };
}
