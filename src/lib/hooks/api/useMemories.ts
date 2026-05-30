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

export interface MemoriesPage {
  data: Memory[];
  total: number;
  page: number;
  limit: number;
}

export function useMemories(
  workspaceId?: string | null,
  opts: {
    limit?: number;
    page?: number;
    q?: string;
    category?: string;
    sort?: string;
  } = {},
) {
  const { limit = 100, page = 1, q, category, sort } = opts;
  const key = [
    ...qk.memories(workspaceId),
    { q, category, sort, limit, page },
  ] as const;
  return useQuery({
    queryKey: key,
    queryFn: () => {
      const params = new URLSearchParams();
      if (workspaceId) params.set('workspaceId', workspaceId);
      params.set('limit', String(limit));
      params.set('page', String(page));
      if (q) params.set('q', q);
      if (category && category !== 'All') params.set('category', category);
      if (sort) params.set('sort', sort);
      return apiFetch<MemoriesPage>(`/api/memories?${params}`);
    },
    select: (d) => ({ memories: d.data ?? [], total: d.total }),
  });
}

export function useAddMemoryItem(workspaceId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch('/api/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, workspaceId: workspaceId ?? null }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memoriesRoot }),
  });
}

export function useEditMemoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiFetch(`/api/memories/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memoriesRoot }),
  });
}

export function useDeleteMemoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/memories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memoriesRoot }),
  });
}

export function useDeleteAllMemories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/api/memories', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memoriesRoot }),
  });
}

export function useReindexMemories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/api/memories/reindex', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.memoriesRoot }),
  });
}
