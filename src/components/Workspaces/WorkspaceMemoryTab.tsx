'use client';

import {
  Brain,
  Plus,
  Trash2,
  LoaderCircle,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatTimeDifference } from '@/lib/utils';
import {
  useWorkspaceMemory,
  useAddMemory,
  useEditMemory,
  useDeleteMemory,
} from '@/lib/hooks/api/useWorkspaceMemory';

export default function WorkspaceMemoryTab({
  workspaceId,
  onCountChange,
  compact = false,
}: {
  workspaceId: string;
  onCountChange?: (n: number) => void;
  compact?: boolean;
}) {
  const { data: memories = [], isLoading } = useWorkspaceMemory(workspaceId);
  const addMemory = useAddMemory(workspaceId);
  const editMemory = useEditMemory(workspaceId);
  const deleteMemory = useDeleteMemory(workspaceId);

  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    onCountChange?.(memories.length);
  }, [memories.length, onCountChange]);

  function handleAdd() {
    if (!newContent.trim()) return;
    addMemory.mutate(newContent.trim(), {
      onSuccess: () => {
        setNewContent('');
        setIsAdding(false);
      },
    });
  }

  function startEdit(id: string, content: string) {
    setEditingId(id);
    setEditContent(content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent('');
  }

  function saveEdit(id: string) {
    if (!editContent.trim()) return;
    editMemory.mutate(
      { id, content: editContent.trim() },
      { onSuccess: cancelEdit },
    );
  }

  function handleDelete(id: string) {
    if (!window.confirm('Delete this memory?')) return;
    deleteMemory.mutate(id);
  }

  return (
    <div className="space-y-4">
      <div
        className={
          compact
            ? 'flex flex-col gap-2'
            : 'flex items-center justify-between gap-3'
        }
      >
        <p className="text-sm text-fg/50">
          Memories scoped to this workspace. These are retrieved only in
          workspace chats.
        </p>
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition shrink-0 ${compact ? 'w-full' : ''}`}
        >
          <Plus size={14} />
          Add memory
        </button>
      </div>

      {isAdding && (
        <div className="p-4 bg-surface rounded-floating border border-accent/50">
          <p className="text-xs text-accent mb-2 font-medium">
            Save to workspace
          </p>
          <textarea
            aria-label="New workspace memory content"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter a fact, preference, or instruction to remember..."
            className="w-full min-h-15 text-sm border border-surface-2 rounded-surface p-3 bg-surface focus:outline-none focus:border-accent resize-y"
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
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewContent('');
              }}
              className="px-3 py-1.5 text-sm rounded-surface hover:bg-surface-2 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newContent.trim() || addMemory.isPending}
              className="px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {addMemory.isPending && (
                <LoaderCircle size={12} className="animate-spin" />
              )}
              Save to workspace
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoaderCircle size={20} className="animate-spin text-accent" />
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-12">
          <Brain size={36} className="mx-auto mb-3 text-fg/20" />
          <p className="text-sm text-fg/40">No workspace memories yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-2 border border-surface-2 rounded-floating">
          {memories.map((m) => {
            const isEditing = editingId === m.id;
            return (
              <li key={m.id} className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <textarea
                      aria-label="Edit workspace memory content"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-bg border border-surface-2 rounded-surface p-2 text-sm focus:outline-none focus:border-accent resize-y min-h-[60px]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          saveEdit(m.id);
                        }
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {m.content}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs px-1.5 py-0.5 rounded-control bg-accent/20 text-accent font-medium">
                      workspace
                    </span>
                    {m.sourceType && (
                      <span className="text-xs text-fg/40">{m.sourceType}</span>
                    )}
                    <span className="text-xs text-fg/40">
                      {m.lastAccessedAt
                        ? `Last used ${formatTimeDifference(new Date(), new Date(m.lastAccessedAt))} ago`
                        : 'Never used'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => saveEdit(m.id)}
                        disabled={editMemory.isPending || !editContent.trim()}
                        className="text-fg/40 hover:text-accent transition disabled:opacity-40"
                        title="Save"
                      >
                        {editMemory.isPending ? (
                          <LoaderCircle
                            size={14}
                            className="animate-spin text-accent"
                          />
                        ) : (
                          <Check size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="text-fg/40 hover:text-fg transition"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(m.id, m.content)}
                        className="text-fg/30 hover:text-fg transition"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        className="text-fg/30 hover:text-danger transition"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
