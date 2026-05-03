'use client';

import { FolderOpen, Plus, LoaderCircle, Archive } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/PageHeader';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import WorkspaceSettingsFields from '@/components/Workspaces/WorkspaceSettingsFields';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

interface CreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

const CreateModal = ({ onClose, onCreated }: CreateModalProps) => {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [autoMemory, setAutoMemory] = useState(false);
  const [autoAcceptFileEdits, setAutoAcceptFileEdits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          icon,
          autoMemoryEnabled: autoMemory ? 1 : 0,
          autoAcceptFileEdits: autoAcceptFileEdits ? 1 : 0,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? 'Failed to create workspace');
        setSubmitting(false);
      } else {
        const j = await res.json();
        onCreated();
        onClose();
        router.push(`/workspaces/${j.workspace.id}`);
      }
    } catch {
      setError('Failed to create workspace');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="bg-surface rounded-floating border border-surface-2 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-medium mb-4">New Workspace</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <WorkspaceSettingsFields
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            color={color}
            icon={icon}
            onAppearanceChange={(next) => {
              setColor(next.color);
              setIcon(next.icon);
            }}
            autoMemory={autoMemory}
            onAutoMemoryChange={setAutoMemory}
            autoAcceptFileEdits={autoAcceptFileEdits}
            onAutoAcceptFileEditsChange={setAutoAcceptFileEdits}
            autoFocusName
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-surface hover:bg-surface-2 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="px-4 py-2 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && (
                <LoaderCircle size={14} className="animate-spin" />
              )}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const WorkspacesPage = () => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchWorkspaces = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/workspaces${showArchived ? '?archived=true' : ''}`,
      );
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } catch {
      console.error('Failed to fetch workspaces');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  return (
    <div>
      <PageHeader
        icon={FolderOpen}
        title="Workspaces"
        subtitle={
          !loading
            ? `${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`
            : undefined
        }
        actions={
          <>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 transition duration-200',
                showArchived
                  ? 'bg-accent/20 text-accent'
                  : 'bg-surface hover:bg-surface-2',
              )}
            >
              <Archive size={14} />
              {showArchived ? 'Active' : 'Archived'}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition duration-200"
            >
              <Plus size={14} />
              New Workspace
            </button>
          </>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle size={24} className="animate-spin text-accent" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-center py-16">
          <FolderOpen className="mx-auto mb-4 text-fg/20" size={48} />
          <h2 className="text-lg font-medium text-fg/60 mb-2">
            {showArchived ? 'No archived workspaces' : 'No workspaces yet'}
          </h2>
          {!showArchived && (
            <p className="text-sm text-fg/40 max-w-md mx-auto">
              Workspaces let you organize chats, files, and instructions for
              specific projects.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces.map((ws) => {
            const c = workspaceColorClasses(ws.color);
            return (
              <Link
                key={ws.id}
                href={`/workspaces/${ws.id}`}
                className={cn(
                  'flex flex-col gap-2 p-4 bg-surface rounded-floating border transition cursor-pointer',
                  c.border,
                  'hover:opacity-90',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex items-center justify-center w-7 h-7 rounded-control',
                      c.bgTint,
                    )}
                  >
                    <WorkspaceIcon
                      name={ws.icon}
                      color={ws.color}
                      size={16}
                      applyColor
                    />
                  </span>
                  <span className="font-medium truncate">{ws.name}</span>
                </div>
                {ws.description && (
                  <p className="text-xs text-fg/50 line-clamp-2">
                    {ws.description}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchWorkspaces}
        />
      )}
    </div>
  );
};

export default WorkspacesPage;
