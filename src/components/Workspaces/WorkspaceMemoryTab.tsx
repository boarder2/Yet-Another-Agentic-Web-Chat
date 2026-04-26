'use client';

import { Brain, Plus, Trash2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Memory {
  id: string;
  content: string;
  category: string | null;
  sourceType: string | null;
  createdAt: string;
  workspaceId: string | null;
}

export default function WorkspaceMemoryTab({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/memories?workspaceId=${workspaceId}&limit=100`,
      );
      const data = await res.json();
      setMemories(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [workspaceId]);

  async function handleAdd() {
    if (!newContent.trim()) return;
    setSubmitting(true);
    try {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: newContent.trim(), workspaceId }),
      });
      setNewContent('');
      setIsAdding(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this memory?')) return;
    await fetch(`/api/memories/${id}`, { method: 'DELETE' });
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg/50">
          Memories scoped to this workspace. These are retrieved only in
          workspace chats.
        </p>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition"
        >
          <Plus size={14} />
          Add memory
        </button>
      </div>

      {isAdding && (
        <div className="p-4 bg-surface rounded-xl border border-accent/50">
          <p className="text-xs text-accent mb-2 font-medium">
            Save to workspace
          </p>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter a fact, preference, or instruction to remember..."
            className="w-full bg-transparent text-sm resize-none focus:outline-none min-h-[60px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAdd();
              }
              if (e.key === 'Escape') {
                setIsAdding(false);
                setNewContent('');
              }
            }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewContent('');
              }}
              className="px-3 py-1.5 text-sm rounded-lg hover:bg-surface-2 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newContent.trim() || submitting}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Save to workspace
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={20} className="animate-spin text-fg/30" />
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-12">
          <Brain size={36} className="mx-auto mb-3 text-fg/20" />
          <p className="text-sm text-fg/40">No workspace memories yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-2 border border-surface-2 rounded-xl">
          {memories.map((m) => (
            <li key={m.id} className="flex items-start gap-3 p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm">{m.content}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">
                    workspace
                  </span>
                  {m.sourceType && (
                    <span className="text-xs text-fg/40">{m.sourceType}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(m.id)}
                className="text-fg/30 hover:text-red-400 transition shrink-0 mt-0.5"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
