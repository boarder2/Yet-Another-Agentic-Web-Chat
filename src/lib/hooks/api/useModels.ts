'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface ModelEntry {
  displayName: string;
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
