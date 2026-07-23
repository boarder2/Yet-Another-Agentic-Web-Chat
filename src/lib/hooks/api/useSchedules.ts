'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface Schedule {
  id: string;
  workflowId: string;
  label: string;
  inputValues: Record<string, string | string[]> | null;
  cronExpression: string;
  timezone: string | null;
  enabled: number;
  disabledReason: string | null;
  retentionMode?: 'days' | 'count' | 'disabled' | null;
  retentionValue?: number | null;
  lastRunAt: number | string | null;
  lastRunStatus: 'success' | 'error' | null;
  lastRunError: string | null;
  lastRunChatId: string | null;
  createdAt: number | string;
  updatedAt?: number | string;
}

/** A schedule row joined to its workflow name — the Scheduled Tasks tab list. */
export interface ScheduleListItem {
  id: string;
  workflowId: string;
  label: string;
  cronExpression: string;
  timezone: string | null;
  enabled: number;
  disabledReason: string | null;
  lastRunAt: number | string | null;
  lastRunStatus: 'success' | 'error' | null;
  lastRunError: string | null;
  lastRunChatId: string | null;
  createdAt: number | string;
  workflowName: string;
  /** True while one of this schedule's run chats is in flight. */
  running: boolean;
}

/** A scheduled run row as returned by GET /api/schedules/runs. */
export interface ScheduleRunPreview {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  scheduleId: string | null;
  scheduledRunViewed: number | null;
  activeRunMessageId: string | null;
  scheduleLabel: string;
  workflowName: string;
  lastRunStatus: string | null;
  preview: string;
  sourcesCount: number;
}

export type ScheduleInput = Partial<
  Pick<
    Schedule,
    | 'label'
    | 'inputValues'
    | 'cronExpression'
    | 'timezone'
    | 'enabled'
    | 'retentionMode'
    | 'retentionValue'
  >
>;

export function useSchedules() {
  return useQuery({
    queryKey: qk.schedules,
    queryFn: () => apiFetch<ScheduleListItem[]>('/api/schedules'),
    refetchInterval: (q) =>
      (q.state.data ?? []).some((s) => s.running) ? 5000 : 30000,
    refetchOnWindowFocus: true,
  });
}

export function useSchedule(id: string | undefined) {
  return useQuery({
    queryKey: id ? qk.schedule(id) : qk.schedules,
    queryFn: () => apiFetch<Schedule>(`/api/schedules/${id}`),
    enabled: !!id,
  });
}

export function useWorkflowSchedules(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowId ? qk.workflowSchedules(workflowId) : qk.schedules,
    queryFn: () =>
      apiFetch<Schedule[]>(`/api/workflows/${workflowId}/schedules`),
    enabled: !!workflowId,
  });
}

export function useCreateSchedule(workflowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ScheduleInput) =>
      apiFetch<Schedule>(`/api/workflows/${workflowId}/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.schedules });
      qc.invalidateQueries({ queryKey: qk.workflowSchedules(workflowId) });
    },
  });
}

export function usePatchSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ScheduleInput }) =>
      apiFetch<Schedule>(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: qk.schedules });
      qc.invalidateQueries({ queryKey: qk.schedule(updated.id) });
      qc.invalidateQueries({
        queryKey: qk.workflowSchedules(updated.workflowId),
      });
    },
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.schedules }),
  });
}

export function useRunSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ chatId: string; status: 'success' | 'error'; error?: string }>(
        `/api/schedules/${id}/run`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.schedules });
      qc.invalidateQueries({ queryKey: qk.scheduleRuns });
    },
  });
}

export function useScheduleRunsList(limit = 50) {
  return useQuery({
    queryKey: [...qk.scheduleRuns, { limit }],
    queryFn: () =>
      apiFetch<ScheduleRunPreview[]>(`/api/schedules/runs?limit=${limit}`),
    // Poll so an in-flight run updates on completion; faster while one is live.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.activeRunMessageId) ? 5000 : 30000,
    refetchOnWindowFocus: true,
  });
}

export function useScheduleRunsUnread() {
  return useQuery({
    queryKey: qk.scheduleRunsUnread,
    queryFn: () => apiFetch<{ count: number }>('/api/schedules/runs/unread'),
    select: (d) => d.count ?? 0,
    refetchInterval: 30000,
    // Keep polling while backgrounded so the title badge stays current.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    // Always stale so navigating into an observing view refetches immediately.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
