'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export type SettingsPatch = Record<string, string | null>;

/** Fetch the full instance settings map (used by the hydration layer). */
export function fetchSettings(): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>('/api/settings');
}

/** Apply a partial settings update (string upserts, null deletes). */
export function patchSettings(patch: SettingsPatch): Promise<void> {
  return apiFetch<void>('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Reactive read of the full settings map. */
export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: fetchSettings });
}

/** Mutation wrapper that invalidates the cached settings map on success. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings }),
  });
}
