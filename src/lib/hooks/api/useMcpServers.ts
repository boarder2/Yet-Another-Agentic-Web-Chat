'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

// Secrets are never returned by the API; hasToken/hasSecret indicate presence.
export interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: 'auto' | 'streamableHttp' | 'sse';
  resolvedTransport: 'streamableHttp' | 'sse' | null;
  authType: 'none' | 'bearer' | 'oauth_client_credentials' | 'oauth';
  enabled: boolean;
  headerName: string | null;
  hasToken: boolean;
  oauthClientId: string | null;
  hasSecret: boolean;
  oauthScope: string | null;
  lastConnectedAt: number | null;
  status: 'unknown' | 'connected' | 'auth_required' | 'error' | 'disabled';
  lastError: string | null;
  authFailureUntil: number | null;
  toolConfig: Record<
    string,
    { enabled?: boolean; approval?: 'always' | 'never' }
  > | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolDescriptor {
  serverId: string;
  serverName: string;
  toolName: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function useMcpServersList() {
  return useQuery({
    queryKey: qk.mcpServers,
    queryFn: () => apiFetch<{ servers: McpServer[] }>('/api/mcp/servers'),
    select: (d) => d.servers ?? [],
  });
}

export function useMcpServer(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.mcpServer(id ?? ''),
    queryFn: () => apiFetch<{ server: McpServer }>(`/api/mcp/servers/${id}`),
    select: (d) => d.server,
    enabled: !!id,
  });
}

export function useMcpServerTools(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.mcpServerTools(id ?? ''),
    queryFn: () =>
      apiFetch<{ tools: McpToolDescriptor[] }>(`/api/mcp/servers/${id}/tools`),
    select: (d) => d.tools ?? [],
    enabled: !!id,
  });
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      url: string;
      transport?: string;
      authType?: string;
      enabled?: boolean;
      headerName?: string;
      secretToken?: string;
      oauthClientId?: string;
      oauthClientSecret?: string;
      oauthScope?: string;
    }) =>
      apiFetch<{ server: McpServer }>('/api/mcp/servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mcpServers });
    },
  });
}

export function usePatchMcpServer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<{ server: McpServer }>(`/api/mcp/servers/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mcpServers });
      qc.invalidateQueries({ queryKey: qk.mcpServer(id) });
    },
  });
}

export function useDeleteMcpServer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/api/mcp/servers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mcpServers });
    },
  });
}

export function useTestMcpServer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{
        status: string;
        toolCount: number;
        toolNames: string[];
        error?: string;
      }>(`/api/mcp/servers/${id}/test`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mcpServer(id) });
      qc.invalidateQueries({ queryKey: qk.mcpServers });
    },
  });
}

/**
 * Start OAuth authorization for a server: fetches the auth URL from the server,
 * opens it in a popup, and listens for the postMessage result.
 * Returns a promise that resolves with `{ ok, error? }` when the popup closes.
 */
export function useAuthorizeMcpServer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await apiFetch<{
        authorizationUrl?: string;
        alreadyAuthorized?: boolean;
        error?: string;
      }>(`/api/mcp/servers/${id}/authorize`, { method: 'POST' });

      if (data.alreadyAuthorized) {
        return { ok: true };
      }
      if (!data.authorizationUrl) {
        throw new Error(data.error ?? 'No authorization URL returned');
      }

      // Open popup and wait for postMessage from callback
      return new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const popup = window.open(
          data.authorizationUrl,
          'mcp_oauth',
          'width=600,height=700,popup=yes',
        );

        const onMessage = (event: MessageEvent) => {
          // Only accept messages from the same origin
          if (event.origin !== window.location.origin) return;
          try {
            const msg =
              typeof event.data === 'string'
                ? (JSON.parse(event.data) as { type?: string; error?: string })
                : (event.data as { type?: string; error?: string });
            if (msg.type === 'mcp_oauth_success') {
              cleanup();
              resolve({ ok: true });
            } else if (msg.type === 'mcp_oauth_error') {
              cleanup();
              resolve({ ok: false, error: msg.error });
            }
          } catch {
            // ignore non-JSON messages
          }
        };

        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          clearInterval(pollTimer);
          popup?.close();
        };

        window.addEventListener('message', onMessage);

        // Poll for popup closed by user without completing flow
        const pollTimer = setInterval(() => {
          if (popup?.closed) {
            cleanup();
            resolve({ ok: false, error: 'Authorization window closed' });
          }
        }, 500);
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mcpServer(id) });
      qc.invalidateQueries({ queryKey: qk.mcpServers });
    },
  });
}
