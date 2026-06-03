'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface ActiveRun {
  chatId: string;
  messageId: string;
  startedAt: number;
  status: 'running' | 'awaiting_user';
  chatTitle?: string;
}

export interface ActiveRunsData {
  active: ActiveRun[];
  stale: string[];
  unreadCount: number;
  awaitingAttentionCount: number;
}

export function useActiveRuns() {
  return useQuery({
    queryKey: qk.activeRuns,
    queryFn: () => apiFetch<ActiveRunsData>('/api/chat/runs/active'),
    refetchInterval: (q) =>
      (q.state.data?.active?.length ?? 0) > 0 ? 5000 : 30000,
    refetchOnWindowFocus: true,
    // Always treat as stale so navigating into a view that observes this query
    // (e.g. mounting ChatBrowser when opening history) refetches immediately
    // rather than serving the global 30s-cached snapshot. In-progress and
    // unread state must reflect runs started since the last poll.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<{ success: boolean }>('/api/chat/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.activeRuns });
      qc.invalidateQueries({ queryKey: qk.chatsInfiniteRoot });
    },
  });
}

export function useMarkChatSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) =>
      apiFetch<{ historyCount: number; scheduledCount: number }>(
        `/api/chats/${chatId}/seen`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.activeRuns });
      qc.invalidateQueries({ queryKey: qk.chatsInfiniteRoot });
      // Refresh the scheduled-runs list so a viewed run loses its unread dot.
      qc.invalidateQueries({ queryKey: qk.scheduledRuns });
      window.dispatchEvent(
        new CustomEvent('history-runs-unread-changed', {
          detail: { count: data.historyCount },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('scheduled-runs-unread-changed', {
          detail: { count: data.scheduledCount },
        }),
      );
    },
  });
}
