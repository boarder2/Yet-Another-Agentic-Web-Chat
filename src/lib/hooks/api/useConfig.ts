'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export function useConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: () => apiFetch<Record<string, unknown>>('/api/config'),
    // Refetch on tab focus so config-API-backed settings (retention, search
    // providers, private-session duration, model lists) pick up edits made on
    // another device. Overrides the global `refetchOnWindowFocus: false`.
    // Structural sharing keeps the same reference when nothing changed, so the
    // settings page only re-derives when the config actually differs.
    refetchOnWindowFocus: true,
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.config }),
  });
}
