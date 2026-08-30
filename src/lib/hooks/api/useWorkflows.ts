'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import type { ModelRef } from '@/lib/providers/resolveModels';

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  prompt: string;
  focusMode: string;
  chatModel: ModelRef;
  systemModel: ModelRef | null;
  selectedSystemPromptIds: string[] | null;
  selectedMethodologyId: string | null;
  createdAt: number | string;
  updatedAt: number | string;
  /** True while one of this workflow's manual-run chats is in flight. */
  running?: boolean;
}

export type WorkflowInput = Partial<
  Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'running'>
>;

export function useWorkflows() {
  return useQuery({
    queryKey: qk.workflows,
    queryFn: () => apiFetch<Workflow[]>('/api/workflows'),
    // Poll so a workflow's running state clears promptly once a manual run ends.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((w) => w.running) ? 5000 : 30000,
    refetchOnWindowFocus: true,
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: id ? qk.workflow(id) : qk.workflows,
    queryFn: () => apiFetch<Workflow>(`/api/workflows/${id}`),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: WorkflowInput) =>
      apiFetch<Workflow>('/api/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workflows }),
  });
}

export function usePatchWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: WorkflowInput }) =>
      apiFetch<Workflow>(`/api/workflows/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (_r, { id }) => {
      qc.invalidateQueries({ queryKey: qk.workflows });
      qc.invalidateQueries({ queryKey: qk.workflow(id) });
      // A prompt edit can auto-disable child schedules (Decision 18).
      qc.invalidateQueries({ queryKey: qk.schedules });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean; deletedSchedules: number }>(
        `/api/workflows/${id}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workflows });
      qc.invalidateQueries({ queryKey: qk.schedules });
    },
  });
}

/** Manual run: POST values, returns the new chatId to navigate into. */
export function useRunWorkflow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, string | string[]>) =>
      apiFetch<{ chatId: string }>(`/api/workflows/${id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workflows }),
  });
}
