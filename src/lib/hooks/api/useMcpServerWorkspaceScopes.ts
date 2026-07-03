'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export function useMcpServerWorkspaceScopes(serverId: string) {
  return useQuery({
    queryKey: qk.mcpServerWorkspaces(serverId),
    queryFn: () =>
      apiFetch<{ workspaceIds: string[] }>(
        `/api/mcp/servers/${serverId}/workspaces`,
      ),
    select: (d) => d.workspaceIds ?? [],
    enabled: !!serverId,
  });
}

export function useSaveMcpServerWorkspaceScopes(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceIds: string[]) =>
      apiFetch(`/api/mcp/servers/${serverId}/workspaces`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceIds }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.mcpServerWorkspaces(serverId) }),
  });
}
