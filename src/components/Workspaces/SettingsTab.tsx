'use client';

import { useRouter } from 'next/navigation';
import WorkspaceSettingsFields from './WorkspaceSettingsFields';
import { useEffect, useRef, useState } from 'react';
import {
  usePatchWorkspace,
  useArchiveWorkspace,
  useDeleteWorkspace,
} from '@/lib/hooks/api/useWorkspaces';

interface Workspace {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  focusMode?: string | null;
  autoMemoryEnabled?: 0 | 1 | null;
  autoAcceptFileEdits?: 0 | 1;
  archivedAt?: string | null;
}

export default function SettingsTab({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const patch = usePatchWorkspace(workspace.id);
  const archive = useArchiveWorkspace(workspace.id);
  const del = useDeleteWorkspace(workspace.id);

  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [autoMemory, setAutoMemory] = useState<boolean>(
    workspace.autoMemoryEnabled === 1,
  );
  const [autoAcceptFileEdits, setAutoAcceptFileEdits] = useState<boolean>(
    workspace.autoAcceptFileEdits === 1,
  );
  const [color, setColor] = useState<string | null>(workspace.color ?? null);
  const [icon, setIcon] = useState<string | null>(workspace.icon ?? null);
  const [isArchived, setIsArchived] = useState(!!workspace.archivedAt);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const nameRef = useRef(name);
  const descriptionRef = useRef(description);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);

  function applyPatch(data: Record<string, unknown>) {
    patch.mutate(data, { onSuccess: () => router.refresh() });
  }

  function toggleArchive() {
    const action = isArchived ? 'unarchive' : 'archive';
    archive.mutate(action, {
      onSuccess: () => {
        setIsArchived((v) => !v);
        router.refresh();
      },
    });
  }

  function confirmDelete() {
    setDeleting(true);
    del.mutate(undefined, {
      onSuccess: () => router.push('/workspaces'),
      onError: () => {
        console.error('Failed to delete workspace');
        setDeleting(false);
        setShowDeleteConfirm(false);
      },
    });
  }

  return (
    <div className="max-w-lg space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">General</h3>
        <WorkspaceSettingsFields
          variant="settings"
          name={name}
          onNameChange={setName}
          onNameBlur={() => applyPatch({ name: nameRef.current })}
          description={description}
          onDescriptionChange={setDescription}
          onDescriptionBlur={() =>
            applyPatch({ description: descriptionRef.current })
          }
          color={color}
          icon={icon}
          onAppearanceChange={(next) => {
            setColor(next.color);
            setIcon(next.icon);
            applyPatch({ color: next.color, icon: next.icon });
          }}
          autoMemory={autoMemory}
          onAutoMemoryChange={(enabled) => {
            setAutoMemory(enabled);
            applyPatch({ autoMemoryEnabled: enabled ? 1 : 0 });
          }}
          autoAcceptFileEdits={autoAcceptFileEdits}
          onAutoAcceptFileEditsChange={(enabled) => {
            setAutoAcceptFileEdits(enabled);
            applyPatch({ autoAcceptFileEdits: enabled ? 1 : 0 });
          }}
        />
      </section>

      <hr className="border-surface-2" />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Danger zone</h3>
        <div className="rounded-surface border border-surface-2 divide-y divide-surface-2">
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
              type="button"
              onClick={toggleArchive}
              disabled={archive.isPending}
              className="px-3 py-1.5 rounded-surface border border-surface-2 text-sm hover:bg-surface-2 disabled:opacity-50 transition-colors"
            >
              {archive.isPending ? '…' : isArchived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
          <div className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium text-danger">
                Delete workspace
              </p>
              <p className="text-xs text-fg/60">
                Permanently delete this workspace and its files
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 rounded-surface border border-danger text-danger text-sm hover:bg-danger-soft transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
          <div className="w-full max-w-sm mx-4 rounded-floating bg-surface border border-surface-2 p-6 space-y-4 shadow-floating">
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
                aria-label={`Confirm workspace name: ${workspace.name}`}
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className="w-full rounded-surface border border-surface-2 bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
                placeholder={workspace.name}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmName('');
                }}
                className="px-4 py-2 rounded-surface border border-surface-2 text-sm hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting || deleteConfirmName !== workspace.name}
                className="px-4 py-2 rounded-surface bg-danger text-danger-fg text-sm hover:bg-danger disabled:opacity-50 transition-colors"
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
