'use client';

import { FolderOpen, Plus, Loader2, Archive } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

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
          chatModel: { provider: 'default', name: 'default' },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-xl border border-surface-2 p-6 w-full max-w-md">
        <h2 className="text-lg font-medium mb-4">New Workspace</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-3 py-2 text-sm bg-bg rounded-lg border border-surface-2 focus:outline-none focus:border-accent"
            autoFocus
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="px-3 py-2 text-sm bg-bg rounded-lg border border-surface-2 focus:outline-none focus:border-accent resize-none"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg hover:bg-surface-2 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg">
      <div className="max-w-screen-lg w-full px-4 sm:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FolderOpen className="text-accent" size={24} />
            <h1 className="text-2xl font-medium">Workspaces</h1>
            {!loading && (
              <span className="text-sm text-fg/50">
                {workspaces.length} workspace
                {workspaces.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-surface-2 transition duration-200',
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition duration-200"
            >
              <Plus size={14} />
              New Workspace
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-fg/40" />
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
            {workspaces.map((ws) => (
              <Link
                key={ws.id}
                href={`/workspaces/${ws.id}`}
                className="flex flex-col gap-2 p-4 bg-surface rounded-xl border border-surface-2 hover:border-accent/50 transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ws.icon ?? '📁'}</span>
                  <span className="font-medium truncate">{ws.name}</span>
                </div>
                {ws.description && (
                  <p className="text-xs text-fg/50 line-clamp-2">
                    {ws.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

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
