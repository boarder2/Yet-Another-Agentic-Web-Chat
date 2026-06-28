'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

export interface FileMeta {
  id: string;
  name: string;
  mime?: string | null;
  size: number;
  isBinary?: boolean;
  autoAcceptEdits?: number | null;
  updatedAt: number;
}

export function useWorkspaceFiles(workspaceId: string) {
  return useQuery({
    queryKey: qk.workspaceFiles(workspaceId),
    queryFn: () =>
      apiFetch<{ files: FileMeta[] }>(`/api/workspaces/${workspaceId}/files`),
    select: (d) => d.files ?? [],
    enabled: !!workspaceId,
  });
}

export function useUploadWorkspaceFile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      payload: File | { name: string; content: string; mime: string },
    ) => {
      if (payload instanceof File) {
        const fd = new FormData();
        fd.append('file', payload);
        return apiFetch(`/api/workspaces/${workspaceId}/files`, {
          method: 'POST',
          body: fd,
        });
      }
      return apiFetch(`/api/workspaces/${workspaceId}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.workspaceFiles(workspaceId) }),
  });
}

export function usePatchWorkspaceFile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      fileId,
      data,
    }: {
      fileId: string;
      data: Record<string, unknown>;
    }) =>
      apiFetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.workspaceFiles(workspaceId) }),
  });
}

export interface FileContent {
  file: FileMeta;
  content: string;
  isBinary: boolean;
}

export function useWorkspaceFileContent(workspaceId: string, fileId: string) {
  return useQuery({
    queryKey: [...qk.workspaceFiles(workspaceId), fileId, 'content'],
    queryFn: () =>
      apiFetch<FileContent>(`/api/workspaces/${workspaceId}/files/${fileId}`),
    enabled: !!workspaceId && !!fileId,
  });
}

export function useSaveWorkspaceFileContent(
  workspaceId: string,
  fileId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: [...qk.workspaceFiles(workspaceId), fileId, 'content'],
      }),
  });
}

export function useDeleteWorkspaceFile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) =>
      apiFetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.workspaceFiles(workspaceId) }),
  });
}
