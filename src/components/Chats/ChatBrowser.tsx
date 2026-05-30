// src/components/Chats/ChatBrowser.tsx
'use client';

import ChatRow, { WorkspaceMeta } from './ChatRow';
import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import {
  CalendarClock,
  LoaderCircle,
  Pin,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';
import { useConfig } from '@/lib/hooks/api/useConfig';
import {
  useChatsInfinite,
  useChatSearch,
  useChatLlmSearch,
  type ChatsFilter,
  type ChatsPage,
} from '@/lib/hooks/api/useChats';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';

interface Props {
  /** When set, scopes the browser to a single workspace; hides workspace UI. */
  workspaceId?: string;
}

const ChatBrowser = ({ workspaceId }: Props) => {
  const scoped = !!workspaceId;
  const qc = useQueryClient();

  const { data: activeWorkspaces = [] } = useWorkspacesList(false);
  const { data: archivedWorkspaces = [] } = useWorkspacesList(true);
  const { data: configData } = useConfig();

  const [selectedWorkspaceFilters, setSelectedWorkspaceFilters] = useState<
    string[]
  >([]);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [scheduledFilter, setScheduledFilter] = useState<
    'all' | 'scheduled' | 'unscheduled'
  >('all');
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'text' | 'llm'>('text');
  // The query the user committed to an AI search (drives the LLM search query).
  const [llmQuery, setLlmQuery] = useState('');

  const isSearchMode = debouncedQuery.trim().length > 0;

  const chatModel = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const provider = localStorage.getItem('chatModelProvider');
    const model = localStorage.getItem('chatModel');
    return provider && model ? { provider, model } : null;
  }, []);

  const privateSessionDurationMs = useMemo(() => {
    const minutes = (configData as { privateSessionDurationMinutes?: number })
      ?.privateSessionDurationMinutes;
    return typeof minutes === 'number'
      ? minutes * 60 * 1000
      : 24 * 60 * 60 * 1000;
  }, [configData]);

  // Build workspace map for chip rendering
  const workspaceMap = useMemo(() => {
    const map: Record<string, WorkspaceMeta> = {};
    for (const ws of activeWorkspaces) {
      map[ws.id] = {
        name: ws.name,
        icon: ws.icon,
        color: ws.color,
        archived: false,
      };
    }
    for (const ws of archivedWorkspaces) {
      map[ws.id] = {
        name: ws.name,
        icon: ws.icon,
        color: ws.color,
        archived: true,
      };
    }
    return map;
  }, [activeWorkspaces, archivedWorkspaces]);

  // Build browse filter from UI state
  const browseFilter = useMemo((): ChatsFilter => {
    const f: ChatsFilter = {};
    if (scoped) {
      f.workspaceId = workspaceId;
    } else if (selectedWorkspaceFilters.length > 0) {
      f.workspaceIds = selectedWorkspaceFilters;
    }
    if (pinnedOnly) f.pinned = true;
    if (scheduledFilter !== 'all') f.scheduled = scheduledFilter;
    return f;
  }, [
    scoped,
    workspaceId,
    selectedWorkspaceFilters,
    pinnedOnly,
    scheduledFilter,
  ]);

  // Build search filter from UI state
  const searchFilter = useMemo((): Omit<
    ChatsFilter,
    'pinned' | 'scheduled'
  > => {
    if (scoped) return { workspaceId };
    if (selectedWorkspaceFilters.length > 0)
      return { workspaceIds: selectedWorkspaceFilters };
    return {};
  }, [scoped, workspaceId, selectedWorkspaceFilters]);

  // Infinite browse query
  const {
    data: browseData,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage,
    fetchNextPage,
  } = useChatsInfinite(browseFilter);

  const browseChats = useMemo(
    () => browseData?.pages.flatMap((p) => p.chats) ?? [],
    [browseData],
  );
  const browseTotal = browseData?.pages[0]?.total ?? 0;
  const browseTotalMessages = browseData?.pages[0]?.totalMessages ?? 0;

  // Text search
  const { data: textSearchData, isFetching: isTextSearching } = useChatSearch(
    isSearchMode && searchMode === 'text' ? debouncedQuery : '',
    searchFilter,
  );

  // AI (LLM) search — cached in TanStack Query and invalidated by chat
  // mutations alongside text search results.
  const { data: llmData, isFetching: isLlmSearching } = useChatLlmSearch(
    searchMode === 'llm' ? llmQuery : '',
    chatModel,
    searchFilter,
  );

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      if (searchMode === 'llm') setSearchMode('text');
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const textSearchResults = textSearchData?.chats ?? [];
  const textSearchTotalMessages = textSearchData?.totalMessages ?? 0;

  const searchTerms = searchMode === 'llm' ? (llmData?.terms ?? []) : [];

  const searchResults =
    searchMode === 'llm' ? (llmData?.chats ?? []) : textSearchResults;
  const searchTotalMessages =
    searchMode === 'llm'
      ? (llmData?.totalMessages ?? 0)
      : textSearchTotalMessages;
  const isSearching = isTextSearching || isLlmSearching;

  const displayedChats = isSearchMode ? searchResults : browseChats;
  const totalConversations = isSearchMode ? searchResults.length : browseTotal;
  const totalMessages = isSearchMode
    ? searchTotalMessages
    : browseTotalMessages;

  // Infinite scroll
  useEffect(() => {
    if (isSearchMode) return;
    let observer: IntersectionObserver | null = null;
    let cleanup: (() => void) | undefined;
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        const first = entries[0];
        if (first.isIntersecting && hasNextPage && !loading && !loadingMore) {
          fetchNextPage();
        }
      });
      if (sentinelRef.current) observer.observe(sentinelRef.current);
      cleanup = () => {
        if (observer && sentinelRef.current) {
          observer.unobserve(sentinelRef.current);
          observer.disconnect();
        }
      };
    }
    return () => {
      if (cleanup) cleanup();
    };
  }, [hasNextPage, loading, loadingMore, isSearchMode, fetchNextPage]);

  const handleLlmSearch = () => {
    if (!searchQuery.trim() || isLlmSearching) return;
    setSearchMode('llm');
    setLlmQuery(searchQuery);
    setDebouncedQuery(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setLlmQuery('');
    setSearchMode('text');
  };

  const handleDelete = (chatId: string) => {
    // Optimistically remove from all cached infinite pages before refetching
    qc.setQueriesData<InfiniteData<ChatsPage>>(
      { queryKey: ['chats', 'infinite'], exact: false },
      (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            chats: p.chats.filter((c) => c.id !== chatId),
          })),
        };
      },
    );
    qc.invalidateQueries({ queryKey: ['chats', 'infinite'] });
    qc.invalidateQueries({ queryKey: ['chats', 'search'] });
  };

  const toggleWorkspaceFilter = (id: string) => {
    setSelectedWorkspaceFilters((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div>
      {/* Workspace filter chips (unscoped mode only) */}
      {!scoped && activeWorkspaces.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedWorkspaceFilters([])}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors whitespace-nowrap',
              selectedWorkspaceFilters.length === 0
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            All
          </button>
          {activeWorkspaces.map((ws) => {
            const c = workspaceColorClasses(ws.color);
            const selected = selectedWorkspaceFilters.includes(ws.id);
            return (
              <button
                type="button"
                key={ws.id}
                onClick={() => toggleWorkspaceFilter(ws.id)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors whitespace-nowrap',
                  selected
                    ? cn(c.bgTint, c.border, c.text)
                    : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
                )}
              >
                <WorkspaceIcon
                  name={ws.icon}
                  color={ws.color}
                  size={11}
                  applyColor={selected}
                />
                {ws.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => toggleWorkspaceFilter('none')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors whitespace-nowrap',
              selectedWorkspaceFilters.includes('none')
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            No workspace
          </button>
        </div>
      )}

      {/* Header (search bar) */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/40 pointer-events-none"
            size={15}
          />
          <input
            type="text"
            aria-label="Search chats"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLlmSearch();
            }}
            placeholder="Search conversations..."
            className="w-full pl-9 pr-9 py-2 bg-surface border border-surface-2 rounded-surface text-sm focus:outline-none focus:border-fg/30 placeholder:text-fg/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg transition-colors"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleLlmSearch}
          disabled={!searchQuery.trim() || isLlmSearching}
          title="Search with AI"
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-surface text-sm border transition-colors',
            'border-surface-2 bg-surface text-fg/70 hover:text-fg hover:border-fg/30',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isLlmSearching ? (
            <LoaderCircle size={16} className="animate-spin text-accent" />
          ) : (
            <Sparkles size={15} />
          )}
          <span className="hidden sm:inline">AI</span>
        </button>
      </div>

      {/* Pinned/scheduled chips */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setPinnedOnly((v) => !v)}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors',
            pinnedOnly
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
          )}
        >
          <Pin size={11} className={pinnedOnly ? 'fill-current' : ''} />
          Pinned
        </button>
        <button
          type="button"
          onClick={() => {
            setScheduledFilter((prev) =>
              prev === 'all'
                ? 'scheduled'
                : prev === 'scheduled'
                  ? 'unscheduled'
                  : 'all',
            );
          }}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-medium border transition-colors',
            scheduledFilter !== 'all'
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
          )}
        >
          <CalendarClock size={11} />
          {scheduledFilter === 'unscheduled' ? 'Unscheduled' : 'Scheduled'}
        </button>
        {!isSearchMode && totalConversations > 0 && (
          <span className="text-xs text-fg/50">
            {totalMessages} message{totalMessages === 1 ? '' : 's'} in{' '}
            {totalConversations} conversation
            {totalConversations === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Search status */}
      {isSearchMode && (
        <div className="mb-3 text-xs text-fg/50">
          {isSearching ? (
            <span className="flex items-center gap-1.5">
              <LoaderCircle size={16} className="animate-spin text-accent" />
              {isLlmSearching ? 'Searching with AI...' : 'Searching...'}
            </span>
          ) : (
            <>
              <span>
                {searchResults.length === 0
                  ? 'No matching conversations'
                  : `${totalConversations} conversation${totalConversations === 1 ? '' : 's'} found (${totalMessages} message${totalMessages === 1 ? '' : 's'})`}
                {searchMode === 'llm' ? ' (AI search)' : ''}
              </span>
              {searchTerms.length > 0 && (
                <span className="ml-1 text-fg/40">
                  — searched for{' '}
                  {searchTerms.map((t, i) => (
                    <span key={i}>
                      {i > 0 && ', '}
                      &ldquo;{t}&rdquo;
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {loading && browseChats.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!loading && !isSearchMode && browseChats.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <p className="text-fg/70 text-sm">
            {scoped ? 'No chats in this workspace yet.' : 'No chats found.'}
          </p>
        </div>
      )}

      {isSearchMode && !isSearching && searchResults.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <p className="text-fg/70 text-sm">No matching conversations found.</p>
        </div>
      )}

      {displayedChats.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {displayedChats.map((chat, i) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              isLast={i === displayedChats.length - 1}
              isSearchMode={isSearchMode}
              searchTerms={
                searchTerms.length > 0 ? searchTerms : [debouncedQuery]
              }
              hideWorkspaceChip={scoped}
              scopedWorkspaceId={
                scoped ? workspaceId : (chat.workspaceId ?? undefined)
              }
              workspace={
                chat.workspaceId
                  ? (workspaceMap[chat.workspaceId] ?? null)
                  : null
              }
              privateSessionDurationMs={privateSessionDurationMs}
              onDelete={handleDelete}
            />
          ))}
          {loadingMore && !isSearchMode && (
            <div className="flex flex-row items-center justify-center py-4">
              <LoaderCircle size={24} className="animate-spin text-accent" />
            </div>
          )}
          {!isSearchMode && <div ref={sentinelRef} className="h-1" />}
        </div>
      )}
    </div>
  );
};

export default ChatBrowser;
