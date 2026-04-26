'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Workspace {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  focusMode?: string | null;
  autoMemoryEnabled?: 0 | 1 | null;
  archivedAt?: string | null;
}

export default function SettingsTab({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [autoMemory, setAutoMemory] = useState<boolean>(
    workspace.autoMemoryEnabled === 1,
  );
  const [isArchived, setIsArchived] = useState(!!workspace.archivedAt);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [archiving, setArchiving] = useState(false);

  async function saveSettings() {
    setSaving(true);
    await fetch(`/api/workspaces/${workspace.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        autoMemoryEnabled: autoMemory ? 1 : 0,
      }),
    });
    setSaving(false);
    router.refresh();
  }

  async function toggleArchive() {
    setArchiving(true);
    const action = isArchived ? 'unarchive' : 'archive';
    await fetch(`/api/workspaces/${workspace.id}/${action}`, {
      method: 'POST',
    });
    setIsArchived((v) => !v);
    setArchiving(false);
    router.refresh();
  }

  async function confirmDelete() {
    setDeleting(true);
    const res = await fetch(`/api/workspaces/${workspace.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      router.push('/workspaces');
    } else {
      console.error('Failed to delete workspace');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">General</h3>
        <div className="space-y-2">
          <label className="text-xs text-fg/60">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-surface-2 bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-fg/60">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-surface-2 bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Auto-memory</p>
            <p className="text-xs text-fg/60">
              Automatically extract memories from chats in this workspace
            </p>
          </div>
          <button
            onClick={() => setAutoMemory((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoMemory ? 'bg-accent' : 'bg-surface-2'
            }`}
            role="switch"
            aria-checked={autoMemory}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoMemory ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-accent text-accent-fg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </section>

      <hr className="border-surface-2" />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Danger zone</h3>
        <div className="rounded-lg border border-surface-2 divide-y divide-surface-2">
          <div className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium">
                {isArchived ? 'Unarchive workspace' : 'Archive workspace'}
              </p>
              <p className="text-xs text-fg/60">
                {isArchived
                  ? 'Restore this workspace to active status'
                  : 'Hide from main list without deleting'}
              </p>
            </div>
            <button
              onClick={toggleArchive}
              disabled={archiving}
              className="px-3 py-1.5 rounded-lg border border-surface-2 text-sm hover:bg-surface-2 disabled:opacity-50 transition-colors"
            >
              {archiving ? '…' : isArchived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium text-red-500">
                Delete workspace
              </p>
              <p className="text-xs text-fg/60">
                Permanently delete this workspace and its files
              </p>
            </div>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 text-sm hover:bg-red-500/10 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm mx-4 rounded-2xl bg-surface border border-surface-2 p-6 space-y-4 shadow-xl">
            <h2 className="font-semibold text-lg">Delete workspace?</h2>
            <p className="text-sm text-fg/70">
              This will permanently delete{' '}
              <strong>&ldquo;{workspace.name}&rdquo;</strong> and all its files.
              Chats and memories will be detached but not deleted. This cannot
              be undone.
            </p>
            <div className="space-y-1">
              <label className="text-xs text-fg/60">
                Type <strong>{workspace.name}</strong> to confirm
              </label>
              <input
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className="w-full rounded-lg border border-surface-2 bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
                placeholder={workspace.name}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmName('');
                }}
                className="px-4 py-2 rounded-lg border border-surface-2 text-sm hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deleteConfirmName !== workspace.name}
                className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
