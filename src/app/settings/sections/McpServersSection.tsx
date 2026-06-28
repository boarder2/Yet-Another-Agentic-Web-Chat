'use client';

import { useState } from 'react';
import {
  Plug,
  PlusCircle,
  Trash2,
  RefreshCw,
  TestTube,
  LogIn,
  Edit3,
  X,
  Save,
  LoaderCircle,
  CheckCircle,
  AlertCircle,
  WifiOff,
  Wrench,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import AppSwitch from '@/components/ui/AppSwitch';
import { toast } from 'sonner';
import {
  useMcpServersList,
  useMcpServerTools,
  useCreateMcpServer,
  usePatchMcpServer,
  useDeleteMcpServer,
  useTestMcpServer,
  useAuthorizeMcpServer,
  type McpServer,
} from '@/lib/hooks/api/useMcpServers';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';

type AuthType = 'none' | 'bearer' | 'oauth_client_credentials' | 'oauth';
type TransportType = 'auto' | 'streamableHttp' | 'sse';

interface ServerFormState {
  name: string;
  url: string;
  transport: TransportType;
  authType: AuthType;
  headerName: string;
  secretToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
}

const defaultForm = (): ServerFormState => ({
  name: '',
  url: '',
  transport: 'auto',
  authType: 'none',
  headerName: '',
  secretToken: '',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthScope: '',
});

const inputClass =
  'w-full bg-surface border border-surface-2 rounded-control px-3 py-2 text-sm text-fg placeholder:text-fg/40 focus:outline-none focus:border-accent transition-colors duration-150';
const selectClass =
  'w-full bg-surface border border-surface-2 rounded-control px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent transition-colors duration-150';
const labelClass = 'flex flex-col gap-1 text-xs text-fg/60';

function statusBadge(server: McpServer) {
  const { status } = server;
  if (!server.enabled) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg/40">
        <WifiOff size={12} /> Disabled
      </span>
    );
  }
  if (status === 'connected') {
    return (
      <span className="flex items-center gap-1 text-xs text-success">
        <CheckCircle size={12} /> Connected
      </span>
    );
  }
  if (status === 'auth_required') {
    return (
      <span className="flex items-center gap-1 text-xs text-warning">
        <AlertCircle size={12} /> Auth required
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className="flex items-center gap-1 text-xs text-danger"
        title={server.lastError ?? undefined}
      >
        <AlertCircle size={12} /> Error
      </span>
    );
  }
  return <span className="text-xs text-fg/40">Unknown</span>;
}

function ToolsPanel({ server }: { server: McpServer }) {
  const { data: tools = [], isLoading, isError } = useMcpServerTools(server.id);
  const patch = usePatchMcpServer(server.id);

  const updateTool = (
    toolName: string,
    change: { enabled?: boolean; approval?: 'always' | 'never' },
  ) => {
    // Atomic per-tool merge server-side (json_patch) — avoids clobbering other
    // tools' settings when toggling quickly or concurrently with another tab.
    patch.mutate(
      { toolConfigPatch: { [toolName]: change } },
      { onError: () => toast.error('Failed to update tool setting') },
    );
  };

  if (isLoading) {
    return (
      <div className="mt-3 border-t border-surface-2 pt-3 flex items-center gap-2 text-xs text-fg/50">
        <LoaderCircle size={14} className="animate-spin text-accent" />
        Discovering tools…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-3 border-t border-surface-2 pt-3 text-xs text-fg/50">
        Couldn&apos;t load tools. Make sure the server is enabled and connected
        (use Test / Authorize), then Refresh tools.
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <div className="mt-3 border-t border-surface-2 pt-3 text-xs text-fg/50">
        No tools discovered yet. Enable the server and use Test to connect.
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-surface-2 pt-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-fg/40 px-1">
        <span>Enabled · Tool</span>
        <span>Auto-run</span>
      </div>
      {/* Sorted by name for a stable order: discovery can re-list tools in a
          different order after the cache is evicted on a config change. Only
          currently-discovered tools are shown; stale toolConfig keys are ignored. */}
      {[...tools]
        .sort((a, b) => a.toolName.localeCompare(b.toolName))
        .map((t) => {
          const cfg = server.toolConfig?.[t.toolName];
          const enabled = cfg?.enabled !== false;
          const autoRun = cfg?.approval === 'never';
          return (
            <div
              key={t.namespacedName}
              className="flex items-start gap-3 bg-surface-2/40 rounded-control px-3 py-2"
            >
              <div className="pt-0.5">
                <AppSwitch
                  checked={enabled}
                  onChange={(v) => updateTool(t.toolName, { enabled: v })}
                  aria-label={
                    enabled ? `Disable ${t.toolName}` : `Enable ${t.toolName}`
                  }
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-fg block truncate">
                  {t.toolName}
                </span>
                {t.description && (
                  <p
                    className="text-xs text-fg/50 line-clamp-2"
                    title={t.description}
                  >
                    {t.description}
                  </p>
                )}
              </div>
              <div
                className="flex items-center gap-2 shrink-0 pt-0.5"
                title={
                  autoRun
                    ? 'Runs without asking'
                    : 'Asks for approval before each call'
                }
              >
                <span className="text-xs text-fg/50 w-14 text-right">
                  {enabled ? (autoRun ? 'Auto-run' : 'Ask') : ''}
                </span>
                <AppSwitch
                  checked={autoRun}
                  disabled={!enabled}
                  onChange={(v) =>
                    updateTool(t.toolName, {
                      approval: v ? 'never' : 'always',
                    })
                  }
                  aria-label={
                    autoRun
                      ? `Disable auto-run for ${t.toolName}`
                      : `Enable auto-run for ${t.toolName}`
                  }
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}

function ServerRow({ server }: { server: McpServer }) {
  const [editing, setEditing] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [form, setForm] = useState<ServerFormState>({
    name: server.name,
    url: server.url,
    transport: server.transport,
    authType: server.authType,
    headerName: server.headerName ?? '',
    secretToken: '', // never pre-fill secrets
    oauthClientId: server.oauthClientId ?? '',
    oauthClientSecret: '', // never pre-fill secrets
    oauthScope: server.oauthScope ?? '',
  });

  const patch = usePatchMcpServer(server.id);
  const del = useDeleteMcpServer(server.id);
  const test = useTestMcpServer(server.id);
  const authorize = useAuthorizeMcpServer(server.id);
  const qc = useQueryClient();

  const handleSave = () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    const update: Record<string, unknown> = {
      name: form.name.trim(),
      url: form.url.trim(),
      transport: form.transport,
      authType: form.authType,
    };
    if (form.authType === 'bearer') {
      update.headerName = form.headerName.trim() || null;
      if (form.secretToken) update.secretToken = form.secretToken;
    }
    if (form.authType === 'oauth_client_credentials') {
      update.oauthClientId = form.oauthClientId.trim() || null;
      if (form.oauthClientSecret)
        update.oauthClientSecret = form.oauthClientSecret;
      update.oauthScope = form.oauthScope.trim() || null;
    }
    if (form.authType === 'oauth') {
      update.oauthScope = form.oauthScope.trim() || null;
    }
    patch.mutate(update, {
      onSuccess: () => {
        toast.success('Server updated');
        setEditing(false);
      },
      onError: (e) => toast.error(`Failed to update: ${e.message}`),
    });
  };

  const handleTest = () => {
    test.mutate(undefined, {
      onSuccess: (data) => {
        if (data.status === 'connected') {
          toast.success(
            `Connected — ${data.toolCount} tool(s): ${data.toolNames.slice(0, 5).join(', ')}${data.toolNames.length > 5 ? '…' : ''}`,
          );
        } else if (data.status === 'auth_required') {
          toast.warning('Auth required — use Authorize to connect');
        } else {
          toast.error(`Connection failed: ${data.error ?? 'unknown error'}`);
        }
      },
      onError: () => toast.error('Test request failed'),
    });
  };

  const handleAuthorize = () => {
    authorize.mutate(undefined, {
      onSuccess: (data) => {
        if ('ok' in data && data.ok) {
          toast.success('Authorization successful');
          qc.invalidateQueries({ queryKey: qk.mcpServers });
        } else if ('error' in data) {
          toast.error(
            `Authorization failed: ${'error' in data ? data.error : 'unknown'}`,
          );
        }
      },
      onError: (e) => toast.error(`Authorization failed: ${e.message}`),
    });
  };

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: qk.mcpServerTools(server.id) });
    qc.invalidateQueries({ queryKey: qk.mcpServers });
    toast.success('Refreshing tool list…');
  };

  const handleToggle = (enabled: boolean) => {
    patch.mutate(
      { enabled },
      {
        onSuccess: () =>
          toast.success(enabled ? 'Server enabled' : 'Server disabled'),
        onError: () => toast.error('Failed to toggle server'),
      },
    );
  };

  if (editing) {
    return (
      <div className="border border-surface-2 rounded-surface p-4 bg-surface space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Name
            <input
              aria-label="Server name"
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My MCP Server"
            />
          </label>
          <label className={labelClass}>
            URL
            <input
              aria-label="Server URL"
              className={inputClass}
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://example.com/mcp"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Transport
            <select
              aria-label="Transport"
              className={selectClass}
              value={form.transport}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  transport: e.target.value as TransportType,
                }))
              }
            >
              <option value="auto">Auto (probe StreamableHTTP first)</option>
              <option value="streamableHttp">Streamable HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </label>
          <label className={labelClass}>
            Auth Type
            <select
              aria-label="Auth type"
              className={selectClass}
              value={form.authType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  authType: e.target.value as AuthType,
                }))
              }
            >
              <option value="none">None</option>
              <option value="bearer">Bearer / API Key</option>
              <option value="oauth_client_credentials">
                OAuth Client Credentials
              </option>
              <option value="oauth">OAuth (Interactive)</option>
            </select>
          </label>
        </div>
        {form.authType === 'bearer' && (
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Header Name (default: Authorization)
              <input
                aria-label="Header name"
                className={inputClass}
                value={form.headerName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, headerName: e.target.value }))
                }
                placeholder="Authorization"
              />
            </label>
            <label className={labelClass}>
              Token / API Key
              <input
                aria-label="Token or API key"
                className={inputClass}
                type="password"
                value={form.secretToken}
                onChange={(e) =>
                  setForm((f) => ({ ...f, secretToken: e.target.value }))
                }
                placeholder={
                  server.hasToken ? '(leave blank to keep existing)' : 'sk-...'
                }
              />
            </label>
          </div>
        )}
        {form.authType === 'oauth_client_credentials' && (
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Client ID
              <input
                aria-label="Client ID"
                className={inputClass}
                value={form.oauthClientId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, oauthClientId: e.target.value }))
                }
                placeholder="client-id"
              />
            </label>
            <label className={labelClass}>
              Client Secret
              <input
                aria-label="Client secret"
                className={inputClass}
                type="password"
                value={form.oauthClientSecret}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    oauthClientSecret: e.target.value,
                  }))
                }
                placeholder={
                  server.hasSecret
                    ? '(leave blank to keep existing)'
                    : 'client-secret'
                }
              />
            </label>
            <label className={labelClass}>
              Scope (optional)
              <input
                aria-label="OAuth scope"
                className={inputClass}
                value={form.oauthScope}
                onChange={(e) =>
                  setForm((f) => ({ ...f, oauthScope: e.target.value }))
                }
                placeholder="read write"
              />
            </label>
          </div>
        )}
        {form.authType === 'oauth' && (
          <label className={labelClass}>
            Scope (optional)
            <input
              aria-label="OAuth scope"
              className={inputClass}
              value={form.oauthScope}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthScope: e.target.value }))
              }
              placeholder="read write"
            />
          </label>
        )}
        <div className="flex items-center gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-surface bg-surface-2 text-fg/70 hover:text-fg transition-colors duration-150"
          >
            <X size={14} /> Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={patch.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition-colors duration-150 disabled:opacity-50"
          >
            {patch.isPending ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-surface-2 rounded-surface p-4 bg-surface">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Plug size={14} className="text-accent shrink-0" />
            <span className="text-sm font-medium text-fg truncate">
              {server.name}
            </span>
            {statusBadge(server)}
          </div>
          <p className="text-xs text-fg/50 truncate ml-5">{server.url}</p>
          <p className="text-xs text-fg/40 ml-5 mt-0.5">
            {server.authType === 'none'
              ? 'No auth'
              : server.authType.replace(/_/g, ' ')}
            {' · '}
            {server.transport}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AppSwitch
            checked={!!server.enabled}
            onChange={handleToggle}
            aria-label={server.enabled ? 'Disable server' : 'Enable server'}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-surface-2 text-fg/70 hover:text-fg transition-colors duration-150"
        >
          <Edit3 size={12} /> Edit
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={test.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-surface-2 text-fg/70 hover:text-fg transition-colors duration-150 disabled:opacity-50"
        >
          {test.isPending ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : (
            <TestTube size={12} />
          )}
          Test
        </button>
        {server.authType === 'oauth' && (
          <button
            type="button"
            onClick={handleAuthorize}
            disabled={authorize.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-info-soft text-info hover:bg-info-soft/80 border border-info transition-colors duration-150 disabled:opacity-50"
          >
            {authorize.isPending ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <LogIn size={12} />
            )}
            Authorize
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowTools((v) => !v)}
          aria-expanded={showTools}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-surface-2 text-fg/70 hover:text-fg transition-colors duration-150"
        >
          {showTools ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Wrench size={12} /> Tools
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-surface-2 text-fg/70 hover:text-fg transition-colors duration-150"
        >
          <RefreshCw size={12} /> Refresh tools
        </button>
        <button
          type="button"
          onClick={() => {
            if (!confirm(`Delete server "${server.name}"?`)) return;
            del.mutate(undefined, {
              onSuccess: () => toast.success(`Deleted "${server.name}"`),
              onError: () => toast.error('Failed to delete server'),
            });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-danger-soft text-danger hover:bg-danger-soft/80 border border-danger transition-colors duration-150"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
      {server.lastError && server.status === 'error' && (
        <p
          className="text-xs text-danger mt-2 ml-1 truncate"
          title={server.lastError}
        >
          {server.lastError}
        </p>
      )}
      {showTools && <ToolsPanel server={server} />}
    </div>
  );
}

function AddServerForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<ServerFormState>(defaultForm());
  const create = useCreateMcpServer();

  const handleCreate = () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    const data: Record<string, unknown> = {
      name: form.name.trim(),
      url: form.url.trim(),
      transport: form.transport,
      authType: form.authType,
    };
    if (form.authType === 'bearer') {
      data.headerName = form.headerName.trim() || undefined;
      data.secretToken = form.secretToken || undefined;
    }
    if (form.authType === 'oauth_client_credentials') {
      data.oauthClientId = form.oauthClientId.trim() || undefined;
      data.oauthClientSecret = form.oauthClientSecret || undefined;
      data.oauthScope = form.oauthScope.trim() || undefined;
    }
    if (form.authType === 'oauth') {
      data.oauthScope = form.oauthScope.trim() || undefined;
    }
    create.mutate(data as Parameters<typeof create.mutate>[0], {
      onSuccess: () => {
        toast.success(`Server "${form.name}" added`);
        onDone();
      },
      onError: (e) => toast.error(`Failed to add: ${e.message}`),
    });
  };

  return (
    <div className="border border-accent/30 rounded-surface p-4 bg-surface space-y-3">
      <h3 className="text-sm font-semibold text-fg">Add MCP Server</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Name
          <input
            aria-label="Server name"
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="My MCP Server"
          />
        </label>
        <label className={labelClass}>
          URL
          <input
            aria-label="Server URL"
            className={inputClass}
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://example.com/mcp"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Transport
          <select
            aria-label="Transport"
            className={selectClass}
            value={form.transport}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                transport: e.target.value as TransportType,
              }))
            }
          >
            <option value="auto">Auto (probe StreamableHTTP first)</option>
            <option value="streamableHttp">Streamable HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </label>
        <label className={labelClass}>
          Auth Type
          <select
            aria-label="Auth type"
            className={selectClass}
            value={form.authType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                authType: e.target.value as AuthType,
              }))
            }
          >
            <option value="none">None</option>
            <option value="bearer">Bearer / API Key</option>
            <option value="oauth_client_credentials">
              OAuth Client Credentials
            </option>
            <option value="oauth">OAuth (Interactive)</option>
          </select>
        </label>
      </div>
      {form.authType === 'bearer' && (
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Header Name (default: Authorization)
            <input
              aria-label="Header name"
              className={inputClass}
              value={form.headerName}
              onChange={(e) =>
                setForm((f) => ({ ...f, headerName: e.target.value }))
              }
              placeholder="Authorization"
            />
          </label>
          <label className={labelClass}>
            Token / API Key
            <input
              aria-label="Token or API key"
              className={inputClass}
              type="password"
              value={form.secretToken}
              onChange={(e) =>
                setForm((f) => ({ ...f, secretToken: e.target.value }))
              }
              placeholder="sk-..."
            />
          </label>
        </div>
      )}
      {form.authType === 'oauth_client_credentials' && (
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Client ID
            <input
              aria-label="Client ID"
              className={inputClass}
              value={form.oauthClientId}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthClientId: e.target.value }))
              }
              placeholder="client-id"
            />
          </label>
          <label className={labelClass}>
            Client Secret
            <input
              aria-label="Client secret"
              className={inputClass}
              type="password"
              value={form.oauthClientSecret}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthClientSecret: e.target.value }))
              }
              placeholder="client-secret"
            />
          </label>
          <label className={labelClass}>
            Scope (optional)
            <input
              aria-label="OAuth scope"
              className={inputClass}
              value={form.oauthScope}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthScope: e.target.value }))
              }
              placeholder="read write"
            />
          </label>
        </div>
      )}
      {form.authType === 'oauth' && (
        <label className={labelClass}>
          Scope (optional)
          <input
            aria-label="OAuth scope"
            className={inputClass}
            value={form.oauthScope}
            onChange={(e) =>
              setForm((f) => ({ ...f, oauthScope: e.target.value }))
            }
            placeholder="read write"
          />
        </label>
      )}
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={onDone}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-surface bg-surface-2 text-fg/70 hover:text-fg transition-colors duration-150"
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={create.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition-colors duration-150 disabled:opacity-50"
        >
          {create.isPending ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Add Server
        </button>
      </div>
    </div>
  );
}

export default function McpServersSection() {
  const { data: servers = [], isLoading } = useMcpServersList();
  const [adding, setAdding] = useState(false);

  return (
    <SettingsSection title="MCP Servers">
      <div className="space-y-3">
        <p className="text-sm text-fg/60">
          Connect to remote MCP servers to give the agent access to additional
          tools. Expand a server&apos;s Tools to choose which tools the agent
          can use and whether each one asks for approval or auto-runs. New tools
          default to enabled and ask every time.
        </p>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-fg/50 py-4">
            <LoaderCircle size={16} className="animate-spin text-accent" />
            Loading servers…
          </div>
        )}
        {!isLoading && servers.length === 0 && !adding && (
          <p className="text-sm text-fg/50 py-2">
            No MCP servers configured yet.
          </p>
        )}
        {servers.map((server) => (
          <ServerRow key={server.id} server={server} />
        ))}
        {adding && <AddServerForm onDone={() => setAdding(false)} />}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-surface bg-surface-2 text-fg/70 hover:text-fg border border-surface-2 transition-colors duration-150"
          >
            <PlusCircle size={16} />
            Add MCP Server
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
