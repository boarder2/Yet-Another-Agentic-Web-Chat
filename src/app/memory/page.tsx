'use client';

import { cn, formatTimeDifference } from '@/lib/utils';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  X,
  Edit3,
  RefreshCw,
  Loader2,
  Link as LinkIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useCallback } from 'react';

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
  Preference: 'bg-blue-500/20 text-blue-400',
  Profile: 'bg-green-500/20 text-green-400',
  Professional: 'bg-purple-500/20 text-purple-400',
  Project: 'bg-orange-500/20 text-orange-400',
  Instruction: 'bg-yellow-500/20 text-yellow-400',
};

const Page = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('createdAt');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const newInputRef = useRef<HTMLTextAreaElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (selectedCategory !== 'All') params.set('category', selectedCategory);
    params.set('sort', sortBy);
    params.set('limit', '200');

    try {
      const res = await fetch(`/api/memories?${params.toString()}`);
      const data = await res.json();
      setMemories(data.data || []);
      setTotal(data.total || 0);
    } catch {
      console.error('Failed to fetch memories');
    }
    setLoading(false);
  }, [debouncedQuery, selectedCategory, sortBy]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (selectedCategory !== 'All') params.set('category', selectedCategory);
      params.set('sort', sortBy);
      params.set('limit', '200');

      try {
        const res = await fetch(`/api/memories?${params.toString()}`);
        const data = await res.json();
        setMemories(data.data || []);
        setTotal(data.total || 0);
      } catch {
        console.error('Failed to fetch memories');
      }
      setLoading(false);
    };
    load();
  }, [debouncedQuery, selectedCategory, sortBy]);

  const handleAdd = async () => {
    if (!newContent.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent.trim() }),
      });
      if (res.ok) {
        setNewContent('');
        setIsAdding(false);
        fetchMemories();
      }
    } catch {
      console.error('Failed to add memory');
    }
    setIsSubmitting(false);
  };

  const handleEdit = async (id: string) => {
    if (!editContent.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchMemories();
      }
    } catch {
      console.error('Failed to update memory');
    }
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this memory?')) return;
    try {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      fetchMemories();
    } catch {
      console.error('Failed to delete memory');
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('Delete ALL memories? This action cannot be undone.'))
      return;
    try {
      await fetch('/api/memories', { method: 'DELETE' });
      fetchMemories();
    } catch {
      console.error('Failed to delete all memories');
    }
  };

  const handleReindex = async () => {
    if (
      !window.confirm(
        'Re-index all memory embeddings with the current embedding model?',
      )
    )
      return;
    setIsReindexing(true);
    try {
      await fetch('/api/memories/reindex', { method: 'POST' });
      fetchMemories();
    } catch {
      console.error('Failed to reindex memories');
    }
    setIsReindexing(false);
  };

  const startEditing = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg">
      <div className="max-w-screen-lg w-full px-4 sm:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Brain className="text-accent" size={24} />
            <h1 className="text-2xl font-medium">Memory</h1>
            <span className="text-sm text-fg/50">{total} memories</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReindex}
              disabled={isReindexing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-surface hover:bg-surface-2 border border-surface-2 transition duration-200 disabled:opacity-50"
            >
              {isReindexing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Re-index
            </button>
            {memories.length > 0 && (
              <button
                onClick={handleDeleteAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-red-500 bg-surface hover:bg-red-500/10 border border-surface-2 transition duration-200"
              >
                <Trash2 size={14} />
                Delete all
              </button>
            )}
          </div>
        </div>

        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/40"
            />
            <input
              type="text"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-surface rounded-lg border border-surface-2 focus:outline-none focus:border-accent"
            />
            {searchQuery && (
              <button
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
            className="px-3 py-2 text-sm bg-surface rounded-lg border border-surface-2 focus:outline-none focus:border-accent"
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
            className="px-3 py-2 text-sm bg-surface rounded-lg border border-surface-2 focus:outline-none focus:border-accent"
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
          <div className="mb-6 p-4 bg-surface rounded-xl border border-surface-2">
            <textarea
              ref={newInputRef}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Enter a fact, preference, or instruction to remember..."
              className="w-full bg-transparent text-sm resize-none focus:outline-none min-h-[60px]"
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
                disabled={!newContent.trim() || isSubmitting}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="mb-6 flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-surface hover:bg-surface-2 border border-surface-2 border-dashed transition duration-200 w-full justify-center"
          >
            <Plus size={16} />
            Add memory
          </button>
        )}

        {/* Memory list */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-fg/40" />
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center py-16">
            <Brain className="mx-auto mb-4 text-fg/20" size={48} />
            <h2 className="text-lg font-medium text-fg/60 mb-2">
              No memories yet
            </h2>
            <p className="text-sm text-fg/40 max-w-md mx-auto">
              Memories help YAAWC remember facts about you across conversations.
              Add memories manually above, or enable automatic memory detection
              in{' '}
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
                className="group p-4 bg-surface rounded-xl border border-surface-2 hover:border-surface-2/80 transition"
              >
                {editingId === memory.id ? (
                  <div>
                    <textarea
                      ref={editInputRef}
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
                        onClick={() => setEditingId(null)}
                        className="px-2.5 py-1 text-xs rounded-md hover:bg-surface-2 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEdit(memory.id)}
                        disabled={!editContent.trim() || isSubmitting}
                        className="px-2.5 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent/90 transition disabled:opacity-50"
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
                          onClick={() => startEditing(memory)}
                          className="p-1.5 rounded-md hover:bg-surface-2 transition"
                          title="Edit"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(memory.id)}
                          className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 transition"
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
                            'px-2 py-0.5 rounded-full text-xs',
                            categoryColors[memory.category] ||
                              'bg-surface-2 text-fg/60',
                          )}
                        >
                          {memory.category}
                        </span>
                      )}
                      <span className="text-xs text-fg/40">
                        {formatTimeDifference(
                          new Date(),
                          new Date(memory.createdAt),
                        )}{' '}
                        ago
                      </span>
                      {memory.sourceType === 'automatic' &&
                        memory.sourceChatId && (
                          <Link
                            href={`/c/${memory.sourceChatId}`}
                            className="flex items-center gap-1 text-xs text-accent hover:underline"
                          >
                            <LinkIcon size={10} />
                            From conversation
                          </Link>
                        )}
                      {memory.sourceType === 'manual' && (
                        <span className="text-xs text-fg/40">
                          Manually added
                        </span>
                      )}
                      {memory.accessCount > 0 && (
                        <span className="text-xs text-fg/40">
                          Used {memory.accessCount}×
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Page;
