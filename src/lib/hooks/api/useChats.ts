'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number | string;
  workspaceId?: string | null;
  pinned?: number;
  scheduledAt?: string | null;
  focusMode: string;
}

export interface ChatsPage {
  chats: Chat[];
  hasMore: boolean;
  total: number;
  totalMessages: number;
}

export interface ChatsFilter {
  workspaceId?: string;
  workspaceIds?: string[];
  pinned?: boolean;
  scheduled?: 'all' | 'scheduled' | 'unscheduled';
}

const PAGE_LIMIT = 50;

function buildChatsUrl(offset: number, filter: ChatsFilter): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_LIMIT));
  params.set('offset', String(offset));
  if (filter.workspaceId) params.set('workspaceId', filter.workspaceId);
  if (filter.workspaceIds?.length)
    params.set('workspaceIds', filter.workspaceIds.join(','));
  if (filter.pinned) params.set('pinned', '1');
  if (filter.scheduled === 'scheduled') params.set('scheduled', '1');
  else if (filter.scheduled === 'unscheduled') params.set('scheduled', '0');
  return `/api/chats?${params}`;
}

export function useChatsInfinite(filter: ChatsFilter = {}) {
  const key = ['chats', 'infinite', filter] as const;
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam = 0 }: { pageParam: number }) =>
      apiFetch<ChatsPage>(buildChatsUrl(pageParam, filter)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, p) => sum + p.chats.length, 0);
    },
  });
}

export function useChatSearch(
  q: string,
  filter: Omit<ChatsFilter, 'pinned' | 'scheduled'> = {},
) {
  const key = ['chats', 'search', q, filter] as const;
  return useQuery({
    queryKey: key,
    queryFn: () => {
      const params = new URLSearchParams({ q });
      if (filter.workspaceId) params.set('workspaceId', filter.workspaceId);
      if (filter.workspaceIds?.length)
        params.set('workspaceIds', filter.workspaceIds.join(','));
      return apiFetch<{ chats: Chat[]; total: number; totalMessages: number }>(
        `/api/chats?${params}`,
      );
    },
    enabled: q.trim().length > 0,
  });
}
