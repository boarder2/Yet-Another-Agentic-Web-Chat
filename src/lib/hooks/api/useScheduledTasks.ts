'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string | null;
  schedule?: string;
  cronExpression?: string;
  timezone?: string | null;
  prompt?: string;
  focusMode?: string;
  enabled: boolean | number;
  lastRunAt?: number | string | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
  lastRunChatId?: string | null;
  nextRunAt?: string | null;
  createdAt: number | string;
  updatedAt?: string;
}

export interface ScheduledRun {
  id: string;
  taskId: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  read: boolean;
}

export function useScheduledTasks() {
  return useQuery({
    queryKey: qk.scheduledTasks,
    queryFn: () =>
      apiFetch<ScheduledTask[] | { tasks: ScheduledTask[] }>(
        '/api/scheduled-tasks',
      ),
    select: (d) => (Array.isArray(d) ? d : (d.tasks ?? [])),
  });
}

export function useScheduledRuns(unreadOnly = false) {
  return useQuery({
    queryKey: [...qk.scheduledRuns, { unreadOnly }],
    queryFn: () =>
      apiFetch<{ runs: ScheduledRun[] }>(
        unreadOnly
          ? '/api/scheduled-tasks/runs/unread'
          : '/api/scheduled-tasks/runs',
      ),
    select: (d) => d.runs ?? [],
  });
}

export function useCreateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ScheduledTask>) =>
      apiFetch('/api/scheduled-tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.scheduledTasks }),
  });
}

export function usePatchScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ScheduledTask> }) =>
      apiFetch(`/api/scheduled-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.scheduledTasks }),
  });
}

export function useDeleteScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.scheduledTasks }),
  });
}

export function useRunScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/scheduled-tasks/${id}/run`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.scheduledTasks });
      qc.invalidateQueries({ queryKey: qk.scheduledRuns });
    },
  });
}
