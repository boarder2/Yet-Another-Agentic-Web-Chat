'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { flushSettings } from '@/lib/settings/persist';
import type { ReasoningEffort } from '@/lib/providers/reasoningEffort';

export interface ModelEntry {
  displayName: string;
  supportedReasoningEfforts?: ReasoningEffort[];
}

export interface ImageGenerationModel {
  id: string;
  name: string;
}

export interface ModelsResponse {
  chatModelProviders: Record<string, Record<string, ModelEntry>>;
  embeddingModelProviders: Record<string, Record<string, ModelEntry>>;
  imageGenerationModels?: ImageGenerationModel[];
}

export function useModels(includeHidden = false) {
  return useQuery({
    queryKey: [...qk.models, { includeHidden }],
    queryFn: () =>
      apiFetch<ModelsResponse>(
        `/api/models${includeHidden ? '?include_hidden=true' : ''}`,
      ),
  });
}

/**
 * Force the provider model lists to refetch from source. Flushes any pending
 * settings writes first so a just-edited provider URL is persisted before the
 * server re-enumerates models (otherwise the refresh reads the pre-edit URL),
 * then invalidates the cached `useModels` query.
 */
export function useRefreshModels() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async (opts?: { reload?: boolean; silent?: boolean }) => {
    try {
      setRefreshing(true);
      await flushSettings();
      await apiFetch<ModelsResponse>(
        '/api/models?refresh=true&include_hidden=true',
      );
      await queryClient.invalidateQueries({ queryKey: qk.models });
      if (!opts?.silent) {
        toast.success(
          opts?.reload
            ? 'Model list refreshed. Reloading…'
            : 'Model list refreshed.',
        );
      }
      if (opts?.reload) setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      console.error('Failed to refresh models:', err);
      if (!opts?.silent) toast.error('Failed to refresh models');
    } finally {
      setRefreshing(false);
    }
  };

  return { refresh, refreshing };
}
