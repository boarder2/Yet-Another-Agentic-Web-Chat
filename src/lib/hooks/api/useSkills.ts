'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface UserSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  workspaceId: string | null;
  enabled: boolean;
  disableModelInvocation: boolean;
  createdAt: string;
  updatedAt: string;
}

export function useSkills(workspaceId?: string | null) {
  return useQuery({
    queryKey: qk.skills(workspaceId),
    queryFn: () => {
      const url = workspaceId
        ? `/api/skills?workspaceId=${workspaceId}`
        : '/api/skills';
      return apiFetch<UserSkill[]>(url);
    },
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description: string;
      content: string;
      workspaceId?: string | null;
      disableModelInvocation?: boolean;
    }) =>
      apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.skillsRoot }),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Omit<UserSkill, 'id' | 'createdAt' | 'updatedAt'>>;
    }) =>
      apiFetch(`/api/skills/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.skillsRoot }),
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.skillsRoot }),
  });
}

export function useToggleSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/skills/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.skillsRoot }),
  });
}
