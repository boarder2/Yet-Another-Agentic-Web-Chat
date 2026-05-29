'use client';

import PageHeader from '@/components/PageHeader';
import { cn, formatTimeDifference } from '@/lib/utils';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  X,
  Edit3,
  RefreshCw,
  LoaderCircle,
  Link as LinkIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  useMemories,
  useAddMemoryItem,
  useEditMemoryItem,
  useDeleteMemoryItem,
  useDeleteAllMemories,
  useReindexMemories,
} from '@/lib/hooks/api/useMemories';

interface Memory {
  id: string;
  content: string;
  category: string | null;
  sourceType: string | null;
  sourceChatId: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId: string | null;
}

const CATEGORIES = [
  'All',
  'Preference',
  'Profile',
  'Professional',
  'Project',
  'Instruction',
] as const;

const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Date Created' },
  { value: 'lastAccessedAt', label: 'Last Used' },
  { value: 'accessCount', label: 'Times Used' },
] as const;

const categoryColors: Record<string, string> = {
  Preference: 'bg-info-soft text-info',
  Profile: 'bg-success-soft text-success',
  Professional: 'bg-accent/20 text-accent',
  Project: 'bg-warning-soft text-warning',
  Instruction: 'bg-warning-soft text-warning',
};

const Page = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('createdAt');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const newInputRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading: loading } = useMemories(null, {
    q: debouncedQuery || undefined,
    category: selectedCategory !== 'All' ? selectedCategory : undefined,
    sort: sortBy,
    limit: 200,
  });
  const memories = (data?.memories ?? []) as Memory[];
  const total = data?.total ?? 0;

  const addMemory = useAddMemoryItem(null);
  const editMemory = useEditMemoryItem();
  const deleteMemory = useDeleteMemoryItem();
  const deleteAll = useDeleteAllMemories();
  const reindex = useReindexMemories();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleAdd = () => {
    if (!newContent.trim() || addMemory.isPending) return;
    addMemory.mutate(newContent.trim(), {
      onSuccess: () => {
        setNewContent('');
        setIsAdding(false);
      },
    });
  };

  const handleEdit = (id: string) => {
    if (!editContent.trim() || editMemory.isPending) return;
    editMemory.mutate(
      { id, content: editContent.trim() },
      { onSuccess: () => setEditingId(null) },
    );
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Delete this memory?')) return;
    deleteMemory.mutate(id);
  };

  const handleDeleteAll = () => {
    if (!window.confirm('Delete ALL memories? This action cannot be undone.'))
      return;
    deleteAll.mutate(undefined);
  };

  const handleReindex = () => {
    if (
      !window.confirm(
        'Re-index all memory embeddings with the current embedding model?',
      )
    )
      return;
    reindex.mutate(undefined);
  };

  const startEditing = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  return (
    <div>
      <PageHeader
        icon={Brain}
        title="Memory"
        subtitle={`${total} memories`}
        actions={
          <>
            <button
              type="button"
              onClick={handleReindex}
              disabled={reindex.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface bg-surface hover:bg-surface-2 border border-surface-2 transition duration-200 disabled:opacity-50"
            >
              {reindex.isPending ? (
                <LoaderCircle size={14} className="animate-spin text-accent" />
              ) : (
                <RefreshCw size={14} />
              )}
              Re-index
            </button>
            {memories.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={deleteAll.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface text-danger bg-surface hover:bg-danger-soft border border-surface-2 transition duration-200 disabled:opacity-50"
              >
                <Trash2 size={14} />
                Delete all
              </button>
            )}
          </>
        }
      />

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/40"
          />
          <input
            type="text"
            aria-label="Search memories"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm bg-surface rounded-surface border border-surface-2 focus:outline-none focus:border-accent"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-3 py-2 text-sm bg-surface rounded-surface border border-surface-2 focus:outline-none focus:border-accent"
        >
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 text-sm bg-surface rounded-surface border border-surface-2 focus:outline-none focus:border-accent"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Add memory */}
      {isAdding ? (
        <div className="mb-6 p-4 bg-surface rounded-floating border border-surface-2">
          <textarea
            ref={newInputRef}
            aria-label="New memory content"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter a fact, preference, or instruction to remember..."
            className="w-full min-h-15 text-sm border border-surface-2 rounded-surface p-3 bg-surface focus:outline-none focus:border-accent resize-y"
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
            autoFocus
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
              className="px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition disabled:opacity-50"
            >
              {addMemory.isPending ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="mb-6 flex items-center gap-2 px-4 py-2.5 text-sm rounded-surface bg-surface hover:bg-surface-2 border border-surface-2 border-dashed transition duration-200 w-full justify-center"
        >
          <Plus size={16} />
          Add memory
        </button>
      )}

      {/* Memory list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle size={24} className="animate-spin text-accent" />
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-16">
          <Brain className="mx-auto mb-4 text-fg/20" size={48} />
          <h2 className="text-lg font-medium text-fg/60 mb-2">
            No memories yet
          </h2>
          <p className="text-sm text-fg/40 max-w-md mx-auto">
            Memories help YAAWC remember facts about you across conversations.
            Add memories manually above, or enable automatic memory detection in{' '}
            <Link href="/settings" className="text-accent hover:underline">
              Settings
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className="group p-4 bg-surface rounded-floating border border-surface-2 hover:border-surface-2/80 transition"
            >
              {editingId === memory.id ? (
                <div>
                  <textarea
                    ref={editInputRef}
                    aria-label="Edit memory content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-transparent text-sm resize-none focus:outline-none min-h-[40px]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleEdit(memory.id);
                      }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-2.5 py-1 text-xs rounded-control hover:bg-surface-2 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(memory.id)}
                      disabled={!editContent.trim() || editMemory.isPending}
                      className="px-2.5 py-1 text-xs rounded-control bg-accent text-accent-fg hover:bg-accent/90 transition disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className="text-sm flex-1 cursor-pointer"
                      onClick={() => startEditing(memory)}
                    >
                      {memory.content}
                    </p>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditing(memory)}
                        className="p-1.5 rounded-control hover:bg-surface-2 transition"
                        title="Edit"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(memory.id)}
                        className="p-1.5 rounded-control hover:bg-danger-soft text-danger transition"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {memory.category && (
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-pill text-xs',
                          categoryColors[memory.category] ||
                            'bg-surface-2 text-fg/60',
                        )}
                      >
                        {memory.category}
                      </span>
                    )}
                    <span className="text-xs text-fg/40">
                      Created{' '}
                      {formatTimeDifference(
                        new Date(),
                        new Date(memory.createdAt),
                      )}{' '}
                      ago
                    </span>
                    <span className="text-xs text-fg/40">
                      {memory.lastAccessedAt
                        ? `Last used ${formatTimeDifference(new Date(), new Date(memory.lastAccessedAt))} ago`
                        : 'Never used'}
                    </span>
                    {memory.sourceType === 'automatic' &&
                      (memory.sourceChatId ? (
                        <Link
                          href={`/c/${memory.sourceChatId}`}
                          className="flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          <LinkIcon size={10} />
                          From conversation
                        </Link>
                      ) : (
                        <span className="text-xs text-fg/40 italic">
                          Source chat no longer exists
                        </span>
                      ))}
                    {memory.sourceType === 'manual' && (
                      <span className="text-xs text-fg/40">Manually added</span>
                    )}
                    {memory.accessCount > 0 && (
                      <span className="text-xs text-fg/40">
                        Used {memory.accessCount}×
                      </span>
                    )}
                    {memory.workspaceId && (
                      <Link
                        href={`/workspaces/${memory.workspaceId}`}
                        className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-control bg-accent/20 text-accent hover:bg-accent/30 transition"
                      >
                        workspace
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Page;
