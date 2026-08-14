'use client';

import { Brain, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatTimeDifference } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Textarea } from '@/components/ui/Textarea';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
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
        <p className="text-sm text-fg-muted">
          Memories scoped to this workspace. These are retrieved only in
          workspace chats.
        </p>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => setIsAdding(true)}
          className={`rounded-surface px-3 py-1.5 text-sm shrink-0 ${compact ? 'w-full' : ''}`}
        >
          Add memory
        </Button>
      </div>

      {isAdding && (
        <div className="p-4 bg-surface rounded-floating border border-accent/50">
          <p className="text-xs text-accent mb-2 font-medium">
            Save to workspace
          </p>
          <Textarea
            aria-label="New workspace memory content"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter a fact, preference, or instruction to remember..."
            className="min-h-15 p-3"
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
            <Button
              variant="ghost"
              onClick={() => {
                setIsAdding(false);
                setNewContent('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAdd}
              disabled={!newContent.trim()}
              loading={addMemory.isPending}
            >
              Save to workspace
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <ListLoading layout="section" size={20} />
      ) : memories.length === 0 ? (
        <ListEmptyState
          layout="section"
          icon={Brain}
          title="No workspace memories yet."
        />
      ) : (
        <ul className="divide-y divide-surface-2 border border-surface-2 rounded-floating">
          {memories.map((m) => {
            const isEditing = editingId === m.id;
            return (
              <li key={m.id} className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <Textarea
                      aria-label="Edit workspace memory content"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="rounded-surface p-2 min-h-[60px]"
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
                      <span className="text-xs text-fg-subtle">
                        {m.sourceType}
                      </span>
                    )}
                    <span className="text-xs text-fg-subtle">
                      {m.lastAccessedAt
                        ? `Last used ${formatTimeDifference(new Date(), new Date(m.lastAccessedAt))} ago`
                        : 'Never used'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {isEditing ? (
                    <>
                      <IconButton
                        icon={Check}
                        label="Save"
                        loading={editMemory.isPending}
                        disabled={!editContent.trim()}
                        onClick={() => saveEdit(m.id)}
                      />
                      <IconButton
                        icon={X}
                        label="Cancel"
                        onClick={cancelEdit}
                      />
                    </>
                  ) : (
                    <>
                      <IconButton
                        icon={Pencil}
                        label="Edit"
                        onClick={() => startEdit(m.id, m.content)}
                      />
                      <IconButton
                        icon={Trash2}
                        label="Delete"
                        tone="danger"
                        onClick={() => handleDelete(m.id)}
                      />
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
