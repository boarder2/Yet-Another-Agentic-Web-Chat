'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface OpenAICompatibleProvider {
  id: string;
  name: string;
  normalizedName: string;
  baseUrl: string;
  enabled: boolean;
  supportsEmbeddings: boolean;
  /** Header names only. Header values are never returned by the API. */
  headerNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenAICompatibleProviderInput {
  name: string;
  baseUrl: string;
  enabled?: boolean;
  supportsEmbeddings?: boolean;
  headers?: Record<string, string>;
}

export interface OpenAICompatibleProviderPatch {
  name?: string;
  baseUrl?: string;
  enabled?: boolean;
  supportsEmbeddings?: boolean;
  headersPatch?: Record<string, string | null>;
}

export interface OpenAICompatibleProviderTestResult {
  ok: true;
  modelCount: number;
}

function invalidateProviderQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  id?: string,
) {
  queryClient.invalidateQueries({ queryKey: qk.openAICompatibleProviders });
  if (id) {
    queryClient.invalidateQueries({
      queryKey: qk.openAICompatibleProvider(id),
    });
  }
  queryClient.invalidateQueries({ queryKey: qk.models });
  queryClient.invalidateQueries({ queryKey: qk.config });
}

export function useOpenAICompatibleProviders() {
  return useQuery({
    queryKey: qk.openAICompatibleProviders,
    queryFn: () =>
      apiFetch<{ providers: OpenAICompatibleProvider[] }>(
        '/api/providers/openai-compatible',
      ),
    select: (data) => data.providers ?? [],
  });
}

export function useOpenAICompatibleProvider(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.openAICompatibleProvider(id ?? ''),
    queryFn: () =>
      apiFetch<{ provider: OpenAICompatibleProvider }>(
        `/api/providers/openai-compatible/${id}`,
      ),
    select: (data) => data.provider,
    enabled: !!id,
  });
}

export function useCreateOpenAICompatibleProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OpenAICompatibleProviderInput) =>
      apiFetch<{ provider: OpenAICompatibleProvider }>(
        '/api/providers/openai-compatible',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => invalidateProviderQueries(queryClient),
  });
}

export function usePatchOpenAICompatibleProvider(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OpenAICompatibleProviderPatch) =>
      apiFetch<{ provider: OpenAICompatibleProvider }>(
        `/api/providers/openai-compatible/${id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => invalidateProviderQueries(queryClient, id),
  });
}

export function useDeleteOpenAICompatibleProvider(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/api/providers/openai-compatible/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateProviderQueries(queryClient, id),
  });
}

export function useTestOpenAICompatibleProvider(id: string) {
  return useMutation({
    mutationFn: () =>
      apiFetch<OpenAICompatibleProviderTestResult>(
        `/api/providers/openai-compatible/${id}/test`,
        { method: 'POST' },
      ),
  });
}

// Keep the verb used by callers that describe a partial update as an update.
export const useUpdateOpenAICompatibleProvider =
  usePatchOpenAICompatibleProvider;
