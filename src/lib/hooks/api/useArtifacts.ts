'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import type { HistoryType } from '@/lib/history/service';

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

/** Every artifact, with its owning chat's title for provenance. */
export interface ArtifactListSummary extends ArtifactSummary {
  chatTitle: string | null;
}

export type HistoryPageItem = ArtifactListSummary & {
  type: 'page';
};

export interface HistoryImageItem {
  type: 'image';
  id: string;
  extension: string;
  mimeType: string;
  prompt: string;
  assistantMessageId: string;
  chatId: string | null;
  workspaceId: string | null;
  createdAt: string;
  imageUrl: string;
  chatTitle: string | null;
  title: string;
  updatedAt: string;
  latestVersion: number;
  versionCount: number;
}

export type HistoryItem = HistoryPageItem | HistoryImageItem;

export interface ArgsWorkspaceFilter {
  workspaceIds?: string[];
  type?: HistoryType;
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

/** Every artifact the workspace owns — the sidebar's list. */
export function useWorkspaceArtifacts(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: qk.workspaceArtifacts(workspaceId ?? ''),
    queryFn: () =>
      apiFetch<ArtifactSummary[]>(`/api/artifacts?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
  });
}

/** Every artifact across all chats and workspaces, optionally filtered by scope and type. */
export function useAllArtifacts(filter: ArgsWorkspaceFilter = {}) {
  const type = filter.type ?? 'all';
  const queryFilter = { ...filter, type };

  return useQuery({
    queryKey: qk.allArtifacts(queryFilter),
    queryFn: () => {
      const params = new URLSearchParams({ type });
      if (filter.workspaceIds?.length)
        params.set('workspaceIds', filter.workspaceIds.join(','));
      return apiFetch<HistoryItem[]>(`/api/artifacts?${params}`);
    },
  });
}

/** Workspace artifacts only; the API rejects a chat-scoped id. */
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
