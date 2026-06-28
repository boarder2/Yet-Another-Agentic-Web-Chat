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
  /** True while one of this task's runs is in progress. */
  running?: boolean;
}

export interface ScheduledRun {
  id: string;
  taskId: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  read: boolean;
}

/** A scheduled run row as returned by GET /api/scheduled-tasks/runs. */
export interface ScheduledRunPreview {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  scheduledTaskId: string | null;
  scheduledRunViewed: number | null;
  activeRunMessageId: string | null;
  taskName: string;
  lastRunStatus: string | null;
  preview: string;
  sourcesCount: number;
}

export function useScheduledRunsList(limit = 50) {
  return useQuery({
    queryKey: [...qk.scheduledRuns, { limit }],
    queryFn: () =>
      apiFetch<ScheduledRunPreview[]>(
        `/api/scheduled-tasks/runs?limit=${limit}`,
      ),
    // Poll so an in-flight run updates on completion; faster while one is live.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.activeRunMessageId) ? 5000 : 30000,
    refetchOnWindowFocus: true,
  });
}

export function useScheduledTasks() {
  return useQuery({
    queryKey: qk.scheduledTasks,
    queryFn: () =>
      apiFetch<ScheduledTask[] | { tasks: ScheduledTask[] }>(
        '/api/scheduled-tasks',
      ),
    select: (d) => (Array.isArray(d) ? d : (d.tasks ?? [])),
    // Poll so a task's in-progress state stays current; faster while any run
    // is active so the running indicator clears promptly on completion.
    refetchInterval: (q) => {
      const data = q.state.data;
      const tasks = Array.isArray(data) ? data : (data?.tasks ?? []);
      return tasks.some((t) => t.running) ? 5000 : 30000;
    },
    refetchOnWindowFocus: true,
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

export function useScheduledRunsUnread() {
  return useQuery({
    queryKey: qk.scheduledRunsUnread,
    queryFn: () =>
      apiFetch<{ count: number }>('/api/scheduled-tasks/runs/unread'),
    select: (d) => d.count ?? 0,
    refetchInterval: 30000,
    // Keep polling while the tab is backgrounded so the title badge stays
    // current even when the user isn't looking at this tab.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    // Always treat as stale so navigating into a view that observes this query
    // refetches immediately rather than serving the global 30s-cached snapshot.
    staleTime: 0,
    refetchOnMount: 'always',
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
  const bust = () => {
    qc.invalidateQueries({ queryKey: qk.scheduledTasks });
    qc.invalidateQueries({ queryKey: qk.scheduledRuns });
  };
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/scheduled-tasks/${id}/run`, { method: 'POST' }),
    // Bust on start so the new (running) run shows when navigating back to the
    // list — the run chat row is created server-side as soon as the run begins,
    // well before this synchronous request resolves. Bust again on completion
    // so the finished state (preview, unread dot) is reflected.
    onMutate: bust,
    onSuccess: bust,
  });
}
