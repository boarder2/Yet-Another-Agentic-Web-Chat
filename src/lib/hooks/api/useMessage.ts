'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface FetchedMessage {
  messageId: string;
  chatId: string;
  chatTitle: string | null;
  content: string;
}

export function useMessage(messageId: string, enabled = true) {
  return useQuery({
    queryKey: qk.message(messageId),
    queryFn: () => apiFetch<FetchedMessage>(`/api/messages/${messageId}`),
    enabled: enabled && /^\d+$/.test(messageId),
    staleTime: Infinity,
  });
}
