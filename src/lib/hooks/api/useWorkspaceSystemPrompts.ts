'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface SystemPromptLink {
  systemPromptId: string;
}

export function useWorkspaceSystemPrompts(workspaceId: string) {
  return useQuery({
    queryKey: qk.workspaceSysPrompts(workspaceId),
    queryFn: () =>
      apiFetch<{ links: SystemPromptLink[] }>(
        `/api/workspaces/${workspaceId}/system-prompts`,
      ),
    select: (d) => (d.links ?? []).map((l) => l.systemPromptId),
    enabled: !!workspaceId,
  });
}

export function useSaveWorkspaceSystemPromptLinks(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/api/workspaces/${workspaceId}/system-prompts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: qk.workspaceSysPrompts(workspaceId),
      }),
  });
}
