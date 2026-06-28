'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Search,
  Plus,
  Trash2,
  X,
  Edit3,
  RefreshCw,
  LoaderCircle,
  Brain,
  Link as LinkIcon,
} from 'lucide-react';
import AppSwitch from '@/components/ui/AppSwitch';
import ModelField from '@/components/models/ModelField';
import SettingsSection from '../components/SettingsSection';
import { SettingsType } from '../types';
import { cn, formatTimeDifference } from '@/lib/utils';
import { useLocalStorageString } from '@/lib/hooks/useLocalStorage';
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

export default function MemorySection({
  memoryEnabled,
  memoryRetrievalEnabled,
  memoryAutoDetectionEnabled,
  setMemoryEnabled,
  setMemoryRetrievalEnabled,
  setMemoryAutoDetectionEnabled,
  config,
}: {
  memoryEnabled: boolean;
  memoryRetrievalEnabled: boolean;
  memoryAutoDetectionEnabled: boolean;
  setMemoryEnabled: (val: boolean) => void;
  setMemoryRetrievalEnabled: (val: boolean) => void;
  setMemoryAutoDetectionEnabled: (val: boolean) => void;
  config: SettingsType;
}) {
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

  // The memory-processing model is its own DB-backed setting, independent of the
  // chat picker's system model. Stored under `memoryModel*` (synced to the DB by
  // the settings persistence layer), never config.toml.
  const [memoryModelProvider, setMemoryModelProvider] = useLocalStorageString(
    'memoryModelProvider',
    '',
  );
  const [memoryModelName, setMemoryModelName] = useLocalStorageString(
    'memoryModel',
    '',
  );

  const memoryModel =
    memoryModelProvider && memoryModelName
      ? { provider: memoryModelProvider, model: memoryModelName }
      : null;

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
    <SettingsSection
      title="Memory"
      headerAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReindex}
            disabled={reindex.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-control bg-surface-2 hover:bg-surface border border-surface-2 transition-colors disabled:opacity-50"
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-control text-danger bg-surface-2 hover:bg-danger-soft border border-surface-2 transition-colors disabled:opacity-50"
            >
              <Trash2 size={14} />
              Delete all
            </button>
          )}
        </div>
      }
    >
      <p className="text-xs text-fg/60">
        When enabled, YAAWC can remember facts about you across conversations to
        provide more personalized responses. Memories are stored separately from
        chat history. Automatic detection uses additional LLM tokens.
      </p>

      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Memory</p>
            <p className="text-xs text-fg/60">
              Enable cross-conversation memory
            </p>
          </div>
          <AppSwitch
            checked={memoryEnabled}
            onChange={(val: boolean) => {
              setMemoryEnabled(val);
              localStorage.setItem('memoryEnabled', String(val));
            }}
          />
        </div>

        {memoryEnabled && (
          <>
            <div className="flex items-center justify-between pl-4 border-l-2 border-surface-2">
              <div>
                <p className="text-sm font-medium">
                  Use saved memories in chats
                </p>
                <p className="text-xs text-fg/60">
                  Include relevant memories to personalize responses
                </p>
              </div>
              <AppSwitch
                checked={memoryRetrievalEnabled}
                onChange={(val: boolean) => {
                  setMemoryRetrievalEnabled(val);
                  localStorage.setItem('memoryRetrievalEnabled', String(val));
                }}
              />
            </div>

            <div className="flex items-center justify-between pl-4 border-l-2 border-surface-2">
              <div>
                <p className="text-sm font-medium">
                  Automatic memory detection
                </p>
                <p className="text-xs text-fg/60">
                  Analyze conversations to identify facts worth remembering.
                  Uses additional calls to the memory processing model below.
                </p>
              </div>
              <AppSwitch
                checked={memoryAutoDetectionEnabled}
                onChange={(val: boolean) => {
                  setMemoryAutoDetectionEnabled(val);
                  localStorage.setItem(
                    'memoryAutoDetectionEnabled',
                    String(val),
                  );
                }}
              />
            </div>

            {config.chatModelProviders && (
              <div className="flex flex-col space-y-1 pl-4 border-l-2 border-surface-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Memory Processing Model</p>
                  <ModelField
                    role="system"
                    selectedModel={memoryModel}
                    setSelectedModel={(m) => {
                      setMemoryModelProvider(m.provider);
                      setMemoryModelName(m.model);
                    }}
                    showModelName
                    truncateModelName={false}
                    panelPosition="below"
                  />
                </div>
                <p className="text-xs text-fg/60">
                  Used to extract, deduplicate, and process memories.
                  Independent from the chat/system model chosen in the chat
                  model picker. You may want a faster/cheaper model here.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="h-px bg-surface-2" />

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Stored memories</p>
        <span className="text-xs text-fg/50">{total} total</span>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-2">
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
            className="w-full pl-9 pr-8 py-2 text-sm bg-surface-2 rounded-control border border-surface-2 focus:outline-none focus:border-accent"
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
          className="px-3 py-2 text-sm bg-surface-2 rounded-control border border-surface-2 focus:outline-none focus:border-accent"
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
          className="px-3 py-2 text-sm bg-surface-2 rounded-control border border-surface-2 focus:outline-none focus:border-accent"
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
        <div className="p-3 border border-accent/40 rounded-control bg-surface-2 space-y-2">
          <textarea
            ref={newInputRef}
            aria-label="New memory content"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter a fact, preference, or instruction to remember..."
            className="w-full min-h-15 text-sm border border-surface-2 rounded-control p-3 bg-surface focus:outline-none focus:border-accent resize-y"
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
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewContent('');
              }}
              className="px-3 py-2 text-sm rounded-control bg-surface hover:bg-surface-2 flex items-center gap-1.5"
            >
              <X size={14} />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newContent.trim() || addMemory.isPending}
              className="px-3 py-2 text-sm rounded-control bg-accent text-accent-fg flex items-center gap-1.5 disabled:opacity-50"
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
          className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-control bg-surface-2 hover:bg-surface border border-surface-2 border-dashed transition-colors w-full justify-center"
        >
          <Plus size={16} />
          Add memory
        </button>
      )}

      {/* Memory list */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <LoaderCircle size={24} className="animate-spin text-accent" />
        </div>
      ) : memories.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-fg/50 py-2">
          <Brain size={16} />
          No memories yet. Add one above, or enable automatic detection.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className="group p-3 bg-surface-2 rounded-control border border-surface-2 transition"
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
                      className="px-2.5 py-1 text-xs rounded-control hover:bg-surface transition"
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
                        className="p-1.5 rounded-control hover:bg-surface transition"
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
                            'bg-surface text-fg/60',
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
    </SettingsSection>
  );
}
