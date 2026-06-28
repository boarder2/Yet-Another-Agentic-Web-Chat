'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export function useWorkspaceUrls(workspaceId: string) {
  return useQuery({
    queryKey: qk.workspaceUrls(workspaceId),
    queryFn: () =>
      apiFetch<{ urls: string[] }>(`/api/workspaces/${workspaceId}/urls`),
    select: (d) => d.urls ?? [],
    enabled: !!workspaceId,
  });
}

export function useSaveWorkspaceUrls(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (urls: string[]) =>
      apiFetch(`/api/workspaces/${workspaceId}/urls`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.workspaceUrls(workspaceId) }),
  });
}
