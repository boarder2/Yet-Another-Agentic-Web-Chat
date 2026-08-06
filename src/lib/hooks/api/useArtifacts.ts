'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface ArtifactSummary {
  id: string;
  chatId: string | null;
  workspaceId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: number;
  versionCount: number;
}

export interface ArtifactVersionMeta {
  version: number;
  messageId: string;
  createdAt: string;
  bytes: number;
}

export type ArtifactDetail = ArtifactSummary & {
  versions: ArtifactVersionMeta[];
};

/** The iframe/download URL for a version. Content never travels through the query cache. */
export function artifactRawUrl(
  artifactId: string,
  version?: number,
  download?: boolean,
): string {
  const params = new URLSearchParams();
  if (version !== undefined) params.set('version', String(version));
  if (download) params.set('download', '1');
  const qs = params.toString();
  return `/api/artifacts/${artifactId}/raw${qs ? `?${qs}` : ''}`;
}

export function useArtifacts(chatId: string | null | undefined) {
  return useQuery({
    queryKey: qk.artifacts(chatId ?? ''),
    queryFn: () =>
      apiFetch<ArtifactSummary[]>(`/api/artifacts?chatId=${chatId}`),
    enabled: !!chatId,
  });
}

/** Every document the workspace owns — the sidebar's list. */
export function useWorkspaceArtifacts(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: qk.workspaceArtifacts(workspaceId ?? ''),
    queryFn: () =>
      apiFetch<ArtifactSummary[]>(`/api/artifacts?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
  });
}

/** Workspace documents only; the API rejects a chat-scoped id. */
export function useDeleteArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (artifactId: string) =>
      apiFetch<{ ok: true }>(`/api/artifacts/${artifactId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.artifactsRoot }),
  });
}

export function useArtifact(artifactId: string | null | undefined) {
  return useQuery({
    queryKey: qk.artifact(artifactId ?? ''),
    queryFn: () => apiFetch<ArtifactDetail>(`/api/artifacts/${artifactId}`),
    enabled: !!artifactId,
  });
}

/**
 * The raw HTML of one version, for the read-only source view. Fetched as text
 * rather than through `apiFetch`, which is JSON-only.
 */
export function useArtifactSource(
  artifactId: string | null | undefined,
  version: number | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: qk.artifactSource(artifactId ?? '', version),
    queryFn: async () => {
      const res = await fetch(artifactRawUrl(artifactId!, version));
      if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
      return res.text();
    },
    enabled: enabled && !!artifactId,
  });
}
