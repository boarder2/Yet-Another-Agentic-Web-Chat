'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import type { MappingClientConfig } from '@/lib/maps/config';

export type { MappingClientConfig };

export function fetchMappingConfig(): Promise<MappingClientConfig> {
  return apiFetch<MappingClientConfig>('/api/maps/config');
}

export function useMappingConfig() {
  return useQuery({
    queryKey: qk.mappingConfig,
    queryFn: fetchMappingConfig,
    refetchOnWindowFocus: true,
  });
}

/** Short hook name for map consumers. */
export const useMapping = useMappingConfig;

export interface ClearMappingCacheResult {
  deleted: number;
}

export function clearMappingCache(): Promise<ClearMappingCacheResult> {
  return apiFetch<ClearMappingCacheResult>('/api/maps/cache', {
    method: 'DELETE',
  });
}

export function useClearMappingCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearMappingCache,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.mappingConfig });
      queryClient.invalidateQueries({ queryKey: qk.mappingCache });
    },
  });
}

export const useClearMapCache = useClearMappingCache;
