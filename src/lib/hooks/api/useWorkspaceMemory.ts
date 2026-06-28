'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface Memory {
  id: string;
  content: string;
  category: string | null;
  sourceType: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  workspaceId: string | null;
}

export function useWorkspaceMemory(workspaceId: string) {
  return useQuery({
    queryKey: qk.workspaceMemory(workspaceId),
    queryFn: () =>
      apiFetch<{ data: Memory[] }>(
        `/api/memories?workspaceId=${workspaceId}&limit=100`,
      ),
    select: (d) => d.data ?? [],
    enabled: !!workspaceId,
  });
}

export function useAddMemory(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch('/api/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, workspaceId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workspaceMemory(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.memories(workspaceId) });
    },
  });
}

export function useEditMemory(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiFetch(`/api/memories/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workspaceMemory(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.memories(workspaceId) });
    },
  });
}

export function useDeleteMemory(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/memories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workspaceMemory(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.memories(workspaceId) });
    },
  });
}
