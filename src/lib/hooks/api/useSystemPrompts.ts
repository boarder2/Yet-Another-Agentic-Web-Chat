'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface SystemPrompt {
  id: string;
  name: string;
  content?: string;
  type?: string;
}

export function useSystemPrompts(type?: string) {
  const key = type ? [...qk.systemPrompts, { type }] : qk.systemPrompts;
  const url = type ? `/api/system-prompts?type=${type}` : '/api/system-prompts';
  return useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<
        | SystemPrompt[]
        | { systemPrompts?: SystemPrompt[]; prompts?: SystemPrompt[] }
      >(url),
    select: (d) =>
      Array.isArray(d)
        ? d
        : ((d as { systemPrompts?: SystemPrompt[]; prompts?: SystemPrompt[] })
            .systemPrompts ??
          (d as { prompts?: SystemPrompt[] }).prompts ??
          []),
  });
}

export function useCreateSystemPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; content: string; type?: string }) =>
      apiFetch<SystemPrompt>('/api/system-prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.systemPrompts }),
  });
}

export function useUpdateSystemPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; content?: string; type?: string };
    }) =>
      apiFetch<SystemPrompt>(`/api/system-prompts/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.systemPrompts }),
  });
}

export function useDeleteSystemPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/system-prompts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.systemPrompts }),
  });
}
