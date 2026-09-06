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
  Brain,
  Link as LinkIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import SettingToggleRow from '@/components/ui/SettingToggleRow';
import Badge, { type BadgeTone } from '@/components/ui/Badge';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';
import ModelField from '@/components/models/ModelField';
import SettingsSection from '../components/SettingsSection';
import { SettingsType } from '../types';
import { formatTimeDifference } from '@/lib/utils';
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

type MemoryConfirmation =
  { kind: 'memory'; id: string } | { kind: 'all' } | { kind: 'reindex' };

const categoryTones: Record<string, BadgeTone> = {
  Preference: 'info',
  Profile: 'success',
  Professional: 'accent',
  Project: 'warning',
  Instruction: 'warning',
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
    memoryModelProvider !== '' || memoryModelName !== ''
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
  const [pendingConfirmation, setPendingConfirmation] =
    useState<MemoryConfirmation | null>(null);

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
    setPendingConfirmation({ kind: 'memory', id });
  };

  const handleDeleteAll = () => {
    setPendingConfirmation({ kind: 'all' });
  };

  const handleReindex = () => {
    setPendingConfirmation({ kind: 'reindex' });
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
          <Button
            icon={RefreshCw}
            loading={reindex.isPending}
            onClick={handleReindex}
          >
            Re-index
          </Button>
          {memories.length > 0 && (
            <Button
              icon={Trash2}
              loading={deleteAll.isPending}
              onClick={handleDeleteAll}
              className="text-danger enabled:hover:bg-danger-soft enabled:hover:text-danger"
            >
              Delete all
            </Button>
          )}
        </div>
      }
    >
      <p className="text-xs text-fg-muted">
        When enabled, YAAWC can remember facts about you across conversations to
        provide more personalized responses. Memories are stored separately from
        chat history. Automatic detection uses additional LLM tokens.
      </p>

      <div className="flex flex-col space-y-4">
        <SettingToggleRow
          label="Memory"
          description="Enable cross-conversation memory"
          checked={memoryEnabled}
          onChange={(val: boolean) => {
            setMemoryEnabled(val);
            localStorage.setItem('memoryEnabled', String(val));
          }}
        />

        {memoryEnabled && (
          <>
            <SettingToggleRow
              nested
              label="Use saved memories in chats"
              description="Include relevant memories to personalize responses"
              checked={memoryRetrievalEnabled}
              onChange={(val: boolean) => {
                setMemoryRetrievalEnabled(val);
                localStorage.setItem('memoryRetrievalEnabled', String(val));
              }}
            />

            <SettingToggleRow
              nested
              label="Automatic memory detection"
              description={
                <>
                  Analyze conversations to identify facts worth remembering.
                  Uses additional calls to the memory processing model below.
                </>
              }
              checked={memoryAutoDetectionEnabled}
              onChange={(val: boolean) => {
                setMemoryAutoDetectionEnabled(val);
                localStorage.setItem('memoryAutoDetectionEnabled', String(val));
              }}
            />

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
                <p className="text-xs text-fg-muted">
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
        <span className="text-xs text-fg-subtle">{total} total</span>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            type="text"
            aria-label="Search memories"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8 bg-surface-2"
          />
          {searchQuery && (
            <IconButton
              icon={X}
              label="Clear search"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            />
          )}
        </div>

        <Select
          aria-label="Category"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Sort by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Add memory */}
      {isAdding ? (
        <div className="p-3 border border-accent-border rounded-control bg-surface-2 space-y-2">
          <Textarea
            ref={newInputRef}
            aria-label="New memory content"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter a fact, preference, or instruction to remember..."
            className="min-h-15 p-3"
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
            <Button
              icon={X}
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
              Save
            </Button>
          </div>
        </div>
      ) : (
        <Button
          icon={Plus}
          onClick={() => setIsAdding(true)}
          className="w-full border border-dashed border-surface-2"
        >
          Add memory
        </Button>
      )}

      {/* Memory list */}
      {loading ? (
        <ListLoading layout="compact" size={24} />
      ) : memories.length === 0 ? (
        <ListEmptyState
          layout="compact"
          icon={Brain}
          body="No memories yet. Add one above, or enable automatic detection."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className="group p-3 bg-surface-2 rounded-control border border-surface-2"
            >
              {editingId === memory.id ? (
                <div>
                  <Textarea
                    ref={editInputRef}
                    aria-label="Edit memory content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="bg-transparent border-transparent px-0 py-0 resize-none min-h-[40px]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleEdit(memory.id);
                      }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleEdit(memory.id)}
                      disabled={!editContent.trim()}
                      loading={editMemory.isPending}
                    >
                      Save
                    </Button>
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
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
                      <IconButton
                        icon={Edit3}
                        label="Edit"
                        onClick={() => startEditing(memory)}
                      />
                      <IconButton
                        icon={Trash2}
                        label="Delete"
                        tone="danger"
                        onClick={() => handleDelete(memory.id)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {memory.category && (
                      <Badge tone={categoryTones[memory.category] ?? 'default'}>
                        {memory.category}
                      </Badge>
                    )}
                    <span className="text-xs text-fg-subtle">
                      Created{' '}
                      {formatTimeDifference(
                        new Date(),
                        new Date(memory.createdAt),
                      )}{' '}
                      ago
                    </span>
                    <span className="text-xs text-fg-subtle">
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
                        <span className="text-xs text-fg-subtle italic">
                          Source chat no longer exists
                        </span>
                      ))}
                    {memory.sourceType === 'manual' && (
                      <span className="text-xs text-fg-subtle">
                        Manually added
                      </span>
                    )}
                    {memory.accessCount > 0 && (
                      <span className="text-xs text-fg-subtle">
                        Used {memory.accessCount}×
                      </span>
                    )}
                    {memory.workspaceId && (
                      <Link
                        href={`/workspaces/${memory.workspaceId}`}
                        className="flex items-center gap-1 border border-transparent text-xs px-1.5 py-0.5 rounded-control bg-accent-soft text-accent hover:bg-accent-border transition-colors duration-150 focus-border-neutral"
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

      <ConfirmModal
        open={!!pendingConfirmation}
        onClose={() => setPendingConfirmation(null)}
        title={
          pendingConfirmation?.kind === 'all'
            ? 'Delete all memories'
            : pendingConfirmation?.kind === 'reindex'
              ? 'Re-index memories'
              : 'Delete memory'
        }
        body={
          pendingConfirmation?.kind === 'all' ? (
            <p>Delete ALL memories? This action cannot be undone.</p>
          ) : pendingConfirmation?.kind === 'reindex' ? (
            <p>
              Re-index all memory embeddings with the current embedding model?
            </p>
          ) : (
            <p>Delete this memory?</p>
          )
        }
        confirmLabel={
          pendingConfirmation?.kind === 'reindex' ? 'Re-index' : 'Delete'
        }
        tone={pendingConfirmation?.kind === 'reindex' ? 'primary' : 'danger'}
        loading={
          pendingConfirmation?.kind === 'memory'
            ? deleteMemory.isPending
            : pendingConfirmation?.kind === 'all'
              ? deleteAll.isPending
              : reindex.isPending
        }
        onConfirm={() => {
          if (!pendingConfirmation) return;
          if (pendingConfirmation.kind === 'memory') {
            deleteMemory.mutate(pendingConfirmation.id, {
              onSuccess: () => setPendingConfirmation(null),
            });
          } else if (pendingConfirmation.kind === 'all') {
            deleteAll.mutate(undefined, {
              onSuccess: () => setPendingConfirmation(null),
            });
          } else {
            reindex.mutate(undefined, {
              onSuccess: () => setPendingConfirmation(null),
            });
          }
        }}
      />
    </SettingsSection>
  );
}
