'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

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
  focusMode?: string | null;
}

export function useWorkspacesList(archived?: boolean) {
  return useQuery({
    queryKey: qk.workspaces(archived),
    queryFn: () =>
      apiFetch<{ workspaces: Workspace[] }>(
        `/api/workspaces${archived ? '?archived=true' : ''}`,
      ),
    select: (d) => d.workspaces ?? [],
  });
}

export function useWorkspace(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: qk.workspace(workspaceId ?? ''),
    queryFn: () =>
      apiFetch<{ workspace: Workspace | null }>(
        `/api/workspaces/${workspaceId}`,
      ),
    select: (d) => d.workspace ?? null,
    enabled: !!workspaceId,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      color?: string | null;
      icon?: string | null;
      autoMemoryEnabled?: number;
      autoAcceptFileEdits?: number;
    }) =>
      apiFetch<{ workspace: Workspace }>('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function usePatchWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<{ workspace: Workspace }>(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useArchiveWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'archive' | 'unarchive') =>
      apiFetch(`/api/workspaces/${workspaceId}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useDeleteWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}
