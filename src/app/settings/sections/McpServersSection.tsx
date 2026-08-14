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
  CheckCircle,
  AlertCircle,
  WifiOff,
  Wrench,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import { Button } from '@/components/ui/Button';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import AppSwitch from '@/components/ui/AppSwitch';
import SettingToggleRow from '@/components/ui/SettingToggleRow';
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
import {
  useMcpServerWorkspaceScopes,
  useSaveMcpServerWorkspaceScopes,
} from '@/lib/hooks/api/useMcpServerWorkspaceScopes';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';

type AuthType = 'none' | 'bearer' | 'oauth_client_credentials' | 'oauth';
type TransportType = 'auto' | 'streamableHttp' | 'sse';

interface HeaderRow {
  name: string;
  value: string;
}

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
  extraHeaders: HeaderRow[];
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
  extraHeaders: [],
});

/**
 * Build the `extraHeaders` payload from form rows, or null when there are none.
 * Rows without a name are dropped as incomplete.
 */
const headerRowsToPayload = (
  rows: HeaderRow[],
): Record<string, string> | null => {
  const named = rows.filter((r) => r.name.trim());
  if (!named.length) return null;
  return Object.fromEntries(named.map((r) => [r.name.trim(), r.value]));
};

/**
 * Diff edited rows against the header names the server already has, producing
 * an RFC 7386 merge patch: entries to set, and `null` for entries to delete.
 *
 * Values are write-only — an untouched row keeps its blank value and is simply
 * omitted, so editing one header never asks the user to retype the others.
 * Returns null when nothing changed.
 */
const headerRowsToPatch = (
  rows: HeaderRow[],
  originalNames: string[],
): Record<string, string | null> | null => {
  const patch: Record<string, string | null> = {};

  for (const { name, value } of rows) {
    const trimmed = name.trim();
    // A blank value on a pre-existing header means "leave it alone".
    if (!trimmed || (!value && originalNames.includes(trimmed))) continue;
    patch[trimmed] = value;
  }

  const kept = new Set(rows.map((r) => r.name.trim()));
  for (const name of originalNames) {
    if (!kept.has(name)) patch[name] = null;
  }

  return Object.keys(patch).length ? patch : null;
};

/**
 * Repeatable name/value editor for additional request headers, sent on every
 * transport regardless of auth type. Values are write-only: an existing row
 * arrives with an empty value, so the parent requires re-entry before saving
 * rather than silently blanking a stored credential.
 */
function ExtraHeadersEditor({
  rows,
  onChange,
  storedNames = [],
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  /** Header names already saved — their values stay put if left blank. */
  storedNames?: string[];
}) {
  const update = (i: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-fg-muted">Extra headers</span>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`Header ${i + 1} name`}
            placeholder="Header name"
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            aria-label={`Header ${i + 1} value`}
            type="password"
            placeholder={
              storedNames.includes(row.name.trim()) ? 'Unchanged' : 'Value'
            }
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <IconButton
            icon={Trash2}
            label={`Remove header ${row.name || i + 1}`}
            tone="danger"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        icon={PlusCircle}
        className="self-start"
        onClick={() => onChange([...rows, { name: '', value: '' }])}
      >
        Add header
      </Button>
      <p className="text-xs text-fg-muted">
        Sent on every request, alongside the auth type above. Use for servers
        needing a second credential header. Saved values stay hidden — leave one
        blank to keep it as is.
      </p>
    </div>
  );
}

function statusBadge(server: McpServer) {
  const { status } = server;
  if (!server.enabled) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg-subtle">
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
  return <span className="text-xs text-fg-subtle">Unknown</span>;
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
      <ListLoading
        layout="compact"
        size={20}
        status="Discovering tools…"
        className="mt-3 border-t border-surface-2 pt-3 text-xs"
      />
    );
  }

  if (isError) {
    return (
      <div className="mt-3 border-t border-surface-2 pt-3 text-xs text-fg-muted">
        Couldn&apos;t load tools. Make sure the server is enabled and connected
        (use Test / Authorize), then Refresh tools.
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <ListEmptyState
        layout="compact"
        body="No tools discovered yet. Enable the server and use Test to connect."
        className="mt-3 border-t border-surface-2 pt-3 text-xs"
      />
    );
  }

  return (
    <div className="mt-3 border-t border-surface-2 pt-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-fg-subtle px-1">
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
                    className="text-xs text-fg-muted line-clamp-2"
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
                <span className="text-xs text-fg-subtle w-14 text-right">
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

function WorkspaceScopePanel({
  server,
  scopedIds,
}: {
  server: McpServer;
  scopedIds: string[];
}) {
  const { data: activeWorkspaces = [] } = useWorkspacesList(false);
  const { data: archivedWorkspaces = [] } = useWorkspacesList(true);
  const saveScopes = useSaveMcpServerWorkspaceScopes(server.id);
  const patch = usePatchMcpServer(server.id);

  const workspaces = [...activeWorkspaces, ...archivedWorkspaces];

  const toggleWorkspace = (id: string) => {
    const next = scopedIds.includes(id)
      ? scopedIds.filter((x) => x !== id)
      : [...scopedIds, id];
    saveScopes.mutate(next, {
      onError: () => toast.error('Failed to update workspace scope'),
    });
  };

  const toggleVisibleInGeneralChat = (v: boolean) => {
    patch.mutate(
      { visibleInGeneralChat: v },
      { onError: () => toast.error('Failed to update setting') },
    );
  };

  if (workspaces.length === 0) {
    return (
      <ListEmptyState
        layout="compact"
        body="No workspaces exist yet. This server is available in every chat."
        className="mt-3 border-t border-surface-2 pt-3 text-xs"
      />
    );
  }

  return (
    <div className="mt-3 border-t border-surface-2 pt-3 space-y-3">
      <p className="text-xs text-fg-muted">
        Leave everything unchecked to keep this server available in every chat.
        Check workspaces to restrict it to only those chats.
      </p>
      <ul className="divide-y divide-surface-2 border border-surface-2 rounded-surface">
        {workspaces.map((w) => (
          <li key={w.id} className="flex items-center gap-2 p-2.5">
            <input
              type="checkbox"
              aria-label={`Scope to workspace: ${w.name}`}
              className="accent-accent border border-transparent focus-border-neutral"
              checked={scopedIds.includes(w.id)}
              onChange={() => toggleWorkspace(w.id)}
            />
            <span className="flex-1 text-sm truncate">{w.name}</span>
            {w.archivedAt && (
              <span className="text-xs text-fg-subtle">Archived</span>
            )}
          </li>
        ))}
      </ul>
      {scopedIds.length > 0 && (
        <SettingToggleRow
          className="px-1"
          label="Also show in chats with no workspace"
          mutedLabel
          checked={server.visibleInGeneralChat}
          onChange={toggleVisibleInGeneralChat}
          ariaLabel={
            server.visibleInGeneralChat
              ? 'Hide from chats with no workspace'
              : 'Show in chats with no workspace'
          }
        />
      )}
    </div>
  );
}

function scopeBadge(server: McpServer, scopedCount: number) {
  if (scopedCount === 0) {
    return <span className="text-xs text-fg-subtle">All workspaces</span>;
  }
  return (
    <span className="text-xs text-fg-subtle">
      Scoped: {scopedCount}
      {server.visibleInGeneralChat ? ' + general' : ''}
    </span>
  );
}

function ServerRow({ server }: { server: McpServer }) {
  const [editing, setEditing] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showScope, setShowScope] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { data: scopedIds = [] } = useMcpServerWorkspaceScopes(server.id);
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
    // Names round-trip; values are write-only, so they start blank.
    extraHeaders: server.extraHeaderNames.map((name) => ({ name, value: '' })),
  });
  // Only send extraHeaders when touched — an untouched form has blank values
  // that would otherwise wipe the stored ones.
  const [headersDirty, setHeadersDirty] = useState(false);

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
    if (headersDirty) {
      // A newly added header has no stored value to fall back on.
      const missing = form.extraHeaders.find(
        (r) =>
          r.name.trim() &&
          !r.value &&
          !server.extraHeaderNames.includes(r.name.trim()),
      );
      if (missing) {
        toast.error(`Enter a value for header "${missing.name.trim()}"`);
        return;
      }
      const patch = headerRowsToPatch(
        form.extraHeaders,
        server.extraHeaderNames,
      );
      if (patch) update.extraHeadersPatch = patch;
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
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My MCP Server"
            />
          </Field>
          <Field label="URL">
            <Input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://example.com/mcp"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Transport">
            <Select
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
            </Select>
          </Field>
          <Field label="Auth Type">
            <Select
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
            </Select>
          </Field>
        </div>
        {form.authType === 'bearer' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Header Name (default: Authorization)">
              <Input
                value={form.headerName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, headerName: e.target.value }))
                }
                placeholder="Authorization"
              />
            </Field>
            <Field label="Token / API Key">
              <Input
                type="password"
                value={form.secretToken}
                onChange={(e) =>
                  setForm((f) => ({ ...f, secretToken: e.target.value }))
                }
                placeholder={
                  server.hasToken ? '(leave blank to keep existing)' : 'sk-...'
                }
              />
            </Field>
          </div>
        )}
        {form.authType === 'oauth_client_credentials' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client ID">
              <Input
                value={form.oauthClientId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, oauthClientId: e.target.value }))
                }
                placeholder="client-id"
              />
            </Field>
            <Field label="Client Secret">
              <Input
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
            </Field>
            <Field label="Scope (optional)">
              <Input
                value={form.oauthScope}
                onChange={(e) =>
                  setForm((f) => ({ ...f, oauthScope: e.target.value }))
                }
                placeholder="read write"
              />
            </Field>
          </div>
        )}
        {form.authType === 'oauth' && (
          <Field label="Scope (optional)">
            <Input
              value={form.oauthScope}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthScope: e.target.value }))
              }
              placeholder="read write"
            />
          </Field>
        )}
        <ExtraHeadersEditor
          rows={form.extraHeaders}
          storedNames={server.extraHeaderNames}
          onChange={(extraHeaders) => {
            setHeadersDirty(true);
            setForm((f) => ({ ...f, extraHeaders }));
          }}
        />
        <div className="flex items-center gap-2 justify-end pt-1">
          <Button icon={X} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Save}
            loading={patch.isPending}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Plug size={14} className="text-accent shrink-0" />
            <span className="text-sm font-medium text-fg truncate">
              {server.name}
            </span>
            {statusBadge(server)}
          </div>
          <p className="text-xs text-fg-subtle truncate ml-5">{server.url}</p>
          <p className="text-xs text-fg-subtle ml-5 mt-0.5">
            {server.authType === 'none'
              ? 'No auth'
              : server.authType.replace(/_/g, ' ')}
            {' · '}
            {server.transport}
            {' · '}
            {scopeBadge(server, scopedIds.length)}
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
        <Button size="sm" icon={Edit3} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          icon={TestTube}
          loading={test.isPending}
          onClick={handleTest}
        >
          Test
        </Button>
        {server.authType === 'oauth' && (
          <Button
            size="sm"
            loading={authorize.isPending}
            icon={LogIn}
            onClick={handleAuthorize}
          >
            Authorize
          </Button>
        )}
        <Button
          size="sm"
          icon={showTools ? ChevronDown : ChevronRight}
          onClick={() => setShowTools((v) => !v)}
          aria-expanded={showTools}
        >
          <Wrench size={12} /> Tools
        </Button>
        <Button
          size="sm"
          icon={showScope ? ChevronDown : ChevronRight}
          onClick={() => setShowScope((v) => !v)}
          aria-expanded={showScope}
        >
          <FolderOpen size={12} /> Workspaces
        </Button>
        <Button size="sm" icon={RefreshCw} onClick={handleRefresh}>
          Refresh tools
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={Trash2}
          onClick={() => setConfirmDeleteOpen(true)}
        >
          Delete
        </Button>
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
      {showScope && (
        <WorkspaceScopePanel server={server} scopedIds={scopedIds} />
      )}
      <ConfirmModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete server"
        body={<p>Delete server &quot;{server.name}&quot;?</p>}
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: () => {
              toast.success(`Deleted "${server.name}"`);
              setConfirmDeleteOpen(false);
            },
            onError: () => toast.error('Failed to delete server'),
          })
        }
      />
    </Card>
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
    data.extraHeaders = headerRowsToPayload(form.extraHeaders) ?? undefined;
    create.mutate(data as Parameters<typeof create.mutate>[0], {
      onSuccess: () => {
        toast.success(`Server "${form.name}" added`);
        onDone();
      },
      onError: (e) => toast.error(`Failed to add: ${e.message}`),
    });
  };

  return (
    <div className="border border-accent-border rounded-surface p-4 bg-surface space-y-3">
      <h3 className="text-sm font-semibold text-fg">Add MCP Server</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="My MCP Server"
          />
        </Field>
        <Field label="URL">
          <Input
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://example.com/mcp"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Transport">
          <Select
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
          </Select>
        </Field>
        <Field label="Auth Type">
          <Select
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
          </Select>
        </Field>
      </div>
      {form.authType === 'bearer' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Header Name (default: Authorization)">
            <Input
              value={form.headerName}
              onChange={(e) =>
                setForm((f) => ({ ...f, headerName: e.target.value }))
              }
              placeholder="Authorization"
            />
          </Field>
          <Field label="Token / API Key">
            <Input
              type="password"
              value={form.secretToken}
              onChange={(e) =>
                setForm((f) => ({ ...f, secretToken: e.target.value }))
              }
              placeholder="sk-..."
            />
          </Field>
        </div>
      )}
      {form.authType === 'oauth_client_credentials' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client ID">
            <Input
              value={form.oauthClientId}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthClientId: e.target.value }))
              }
              placeholder="client-id"
            />
          </Field>
          <Field label="Client Secret">
            <Input
              type="password"
              value={form.oauthClientSecret}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthClientSecret: e.target.value }))
              }
              placeholder="client-secret"
            />
          </Field>
          <Field label="Scope (optional)">
            <Input
              value={form.oauthScope}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthScope: e.target.value }))
              }
              placeholder="read write"
            />
          </Field>
        </div>
      )}
      {form.authType === 'oauth' && (
        <Field label="Scope (optional)">
          <Input
            value={form.oauthScope}
            onChange={(e) =>
              setForm((f) => ({ ...f, oauthScope: e.target.value }))
            }
            placeholder="read write"
          />
        </Field>
      )}
      <ExtraHeadersEditor
        rows={form.extraHeaders}
        onChange={(extraHeaders) => setForm((f) => ({ ...f, extraHeaders }))}
      />
      <div className="flex items-center gap-2 justify-end">
        <Button icon={X} onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={Save}
          loading={create.isPending}
          onClick={handleCreate}
        >
          Add Server
        </Button>
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
        <p className="text-sm text-fg-muted">
          Connect to remote MCP servers to give the agent access to additional
          tools. Expand a server&apos;s Tools to choose which tools the agent
          can use and whether each one asks for approval or auto-runs. New tools
          default to enabled and ask every time.
        </p>
        {isLoading && (
          <ListLoading layout="compact" size={20} status="Loading servers…" />
        )}
        {!isLoading && servers.length === 0 && !adding && (
          <ListEmptyState
            layout="compact"
            body="No MCP servers configured yet."
          />
        )}
        {servers.map((server) => (
          <ServerRow key={server.id} server={server} />
        ))}
        {adding && <AddServerForm onDone={() => setAdding(false)} />}
        {!adding && (
          <Button icon={PlusCircle} onClick={() => setAdding(true)}>
            Add MCP Server
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
