// src/components/Chats/ChatBrowser.tsx
'use client';

import ChatRow, { Chat, WorkspaceMeta } from './ChatRow';
import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import { CalendarClock, Pin, Plus, Search, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  /** When set, scopes the browser to a single workspace; hides workspace UI. */
  workspaceId?: string;
}

const Spinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const cls = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';
  return (
    <svg
      aria-hidden="true"
      className={cn(cls, 'text-fg/20 fill-fg/30 animate-spin')}
      viewBox="0 0 100 101"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M100 50.5908C100.003 78.2051 78.1951 100.003 50.5908 100C22.9765 99.9972 0.997224 78.018 1 50.4037C1.00281 22.7993 22.8108 0.997224 50.4251 1C78.0395 1.00281 100.018 22.8108 100 50.4251ZM9.08164 50.594C9.06312 73.3997 27.7909 92.1272 50.5966 92.1457C73.4023 92.1642 92.1298 73.4365 92.1483 50.6308C92.1669 27.8251 73.4392 9.0973 50.6335 9.07878C27.8278 9.06026 9.10003 27.787 9.08164 50.594Z"
        fill="currentColor"
      />
      <path
        d="M93.9676 39.0409C96.393 38.4037 97.8624 35.9116 96.9801 33.5533C95.1945 28.8227 92.871 24.3692 90.0681 20.348C85.6237 14.1775 79.4473 9.36872 72.0454 6.45794C64.6435 3.54717 56.3134 2.65431 48.3133 3.89319C45.869 4.27179 44.3768 6.77534 45.014 9.20079C45.6512 11.6262 48.1343 13.0956 50.5786 12.717C56.5073 11.8281 62.5542 12.5399 68.0406 14.7911C73.527 17.0422 78.2187 20.7487 81.5841 25.4923C83.7976 28.5886 85.4467 32.059 86.4416 35.7474C87.1273 38.1189 89.5423 39.6781 91.9676 39.0409Z"
        fill="currentFill"
      />
    </svg>
  );
};

const ChatBrowser = ({ workspaceId }: Props) => {
  const scoped = !!workspaceId;
  const limit = 50;

  const [privateSessionDurationMs, setPrivateSessionDurationMs] = useState(
    24 * 60 * 60 * 1000,
  );

  // Workspace map for chip rendering and filter chip row
  const [workspaceMap, setWorkspaceMap] = useState<
    Record<string, WorkspaceMeta>
  >({});
  const [workspaceList, setWorkspaceList] = useState<
    { id: string; name: string; icon: string | null; color: string | null }[]
  >([]);

  // Multi-select filter state (unscoped only). 'all' is implicit when empty.
  const [selectedWorkspaceFilters, setSelectedWorkspaceFilters] = useState<
    string[]
  >([]);

  // Browse pagination
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseTotalMessages, setBrowseTotalMessages] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Chat[]>([]);
  const [searchTotalMessages, setSearchTotalMessages] = useState(0);
  const [isTextSearching, setIsTextSearching] = useState(false);
  const [isLlmSearching, setIsLlmSearching] = useState(false);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [searchMode, setSearchMode] = useState<'text' | 'llm'>('text');

  // Filters
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [scheduledFilter, setScheduledFilter] = useState<
    'all' | 'scheduled' | 'unscheduled'
  >('all');

  const isSearchMode = debouncedQuery.trim().length > 0;
  const displayedChats = isSearchMode ? searchResults : chats;
  const isSearching = isTextSearching || isLlmSearching;
  const totalConversations = isSearchMode ? searchResults.length : browseTotal;
  const totalMessages = isSearchMode
    ? searchTotalMessages
    : browseTotalMessages;

  // Build the workspaceId query fragment given current scope or filter selection.
  const workspaceQueryFragment = useMemo(() => {
    if (scoped) return `&workspaceId=${encodeURIComponent(workspaceId!)}`;
    if (selectedWorkspaceFilters.length === 0) return '';
    return `&workspaceIds=${encodeURIComponent(selectedWorkspaceFilters.join(','))}`;
  }, [scoped, workspaceId, selectedWorkspaceFilters]);

  // Fetch workspace list once for filter chips + chip rendering.
  useEffect(() => {
    Promise.all([
      fetch('/api/workspaces').then((r) => r.json()),
      fetch('/api/workspaces?archived=true').then((r) => r.json()),
    ])
      .then(([active, archived]) => {
        const map: Record<string, WorkspaceMeta> = {};
        const list: typeof workspaceList = [];
        for (const ws of active.workspaces ?? []) {
          map[ws.id] = {
            name: ws.name,
            icon: ws.icon,
            color: ws.color,
            archived: false,
          };
          list.push({
            id: ws.id,
            name: ws.name,
            icon: ws.icon,
            color: ws.color,
          });
        }
        for (const ws of archived.workspaces ?? []) {
          map[ws.id] = {
            name: ws.name,
            icon: ws.icon,
            color: ws.color,
            archived: true,
          };
        }
        setWorkspaceMap(map);
        setWorkspaceList(list);
      })
      .catch(() => {});
  }, []);

  const fetchPage = async (
    nextOffset: number,
    pinFilter?: boolean,
    schedFilter?: 'all' | 'scheduled' | 'unscheduled',
  ) => {
    if (nextOffset === 0) setLoading(true);
    else setLoadingMore(true);

    const usePinFilter = pinFilter ?? pinnedOnly;
    const useSchedFilter = schedFilter ?? scheduledFilter;
    const pinnedQuery = usePinFilter ? '&pinned=1' : '';
    const scheduledQuery =
      useSchedFilter === 'scheduled'
        ? '&scheduled=1'
        : useSchedFilter === 'unscheduled'
          ? '&scheduled=0'
          : '';
    const res = await fetch(
      `/api/chats?limit=${limit}&offset=${nextOffset}${pinnedQuery}${scheduledQuery}${workspaceQueryFragment}`,
    );
    const data = await res.json();
    setChats((prev) =>
      nextOffset === 0 ? data.chats : [...prev, ...data.chats],
    );
    setHasMore(data.hasMore);
    setOffset(nextOffset + data.chats.length);
    if (typeof data.total === 'number') setBrowseTotal(data.total);
    if (typeof data.totalMessages === 'number')
      setBrowseTotalMessages(data.totalMessages);
    setLoading(false);
    setLoadingMore(false);
  };

  // Re-fetch from offset 0 whenever scope or workspace-filter selection changes
  useEffect(() => {
    setChats([]);
    setOffset(0);
    setHasMore(true);
    fetchPage(0);
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.privateSessionDurationMinutes === 'number') {
          setPrivateSessionDurationMs(
            data.privateSessionDurationMinutes * 60 * 1000,
          );
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceQueryFragment]);

  // Infinite scroll
  useEffect(() => {
    if (isSearchMode) return;
    let observer: IntersectionObserver | null = null;
    let cleanup: (() => void) | undefined;
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        const first = entries[0];
        if (first.isIntersecting && hasMore && !loading && !loadingMore) {
          fetchPage(offset);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, loadingMore, offset, isSearchMode]);

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Text search
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      setSearchTerms([]);
      setSearchTotalMessages(0);
      return;
    }
    const doTextSearch = async () => {
      setIsTextSearching(true);
      setSearchMode('text');
      setSearchTerms([]);
      try {
        const res = await fetch(
          `/api/chats?q=${encodeURIComponent(debouncedQuery)}${workspaceQueryFragment}`,
        );
        const data = await res.json();
        setSearchResults(data.chats || []);
        setSearchTotalMessages(
          typeof data.totalMessages === 'number' ? data.totalMessages : 0,
        );
      } catch (err) {
        console.error('Text search error:', err);
        setSearchResults([]);
        setSearchTotalMessages(0);
      } finally {
        setIsTextSearching(false);
      }
    };
    doTextSearch();
  }, [debouncedQuery, workspaceQueryFragment]);

  const handleLlmSearch = async () => {
    if (!searchQuery.trim() || isLlmSearching) return;
    const provider =
      typeof window !== 'undefined'
        ? localStorage.getItem('chatModelProvider')
        : null;
    const model =
      typeof window !== 'undefined' ? localStorage.getItem('chatModel') : null;
    setIsLlmSearching(true);
    setSearchMode('llm');
    setSearchTerms([]);
    setDebouncedQuery(searchQuery);
    try {
      const body: Record<string, unknown> = {
        query: searchQuery,
        chatModel: provider && model ? { provider, model } : undefined,
      };
      if (scoped) body.workspaceId = workspaceId;
      else if (selectedWorkspaceFilters.length > 0)
        body.workspaceIds = selectedWorkspaceFilters;
      const res = await fetch('/api/chats/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setSearchResults(data.chats || []);
      setSearchTerms(data.terms || []);
      setSearchTotalMessages(
        typeof data.totalMessages === 'number' ? data.totalMessages : 0,
      );
    } catch (err) {
      console.error('LLM search error:', err);
      setSearchResults([]);
      setSearchTotalMessages(0);
    } finally {
      setIsLlmSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSearchResults([]);
    setSearchTerms([]);
    setSearchTotalMessages(0);
    setSearchMode('text');
  };

  const handleDelete = (chatId: string) => {
    if (isSearchMode) {
      setSearchResults((prev) => prev.filter((c) => c.id !== chatId));
    } else {
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      setOffset((prev) => Math.max(prev - 1, 0));
    }
  };

  const toggleWorkspaceFilter = (id: string) => {
    setSelectedWorkspaceFilters((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div>
      {/* Workspace filter chips (unscoped mode only) */}
      {!scoped && workspaceList.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedWorkspaceFilters([])}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
              selectedWorkspaceFilters.length === 0
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            All
          </button>
          {workspaceList.map((ws) => {
            const c = workspaceColorClasses(ws.color);
            const selected = selectedWorkspaceFilters.includes(ws.id);
            return (
              <button
                key={ws.id}
                onClick={() => toggleWorkspaceFilter(ws.id)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
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
            onClick={() => toggleWorkspaceFilter('none')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
              selectedWorkspaceFilters.includes('none')
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            No workspace
          </button>
        </div>
      )}

      {/* Header (search bar + scoped "+ New chat") */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/40 pointer-events-none"
            size={15}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLlmSearch();
            }}
            placeholder="Search conversations..."
            className="w-full pl-9 pr-9 py-2 bg-surface border border-surface-2 rounded-lg text-sm focus:outline-none focus:border-fg/30 placeholder:text-fg/40"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg transition-colors"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={handleLlmSearch}
          disabled={!searchQuery.trim() || isLlmSearching}
          title="Search with AI"
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors',
            'border-surface-2 bg-surface text-fg/70 hover:text-fg hover:border-fg/30',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isLlmSearching ? <Spinner size="sm" /> : <Sparkles size={15} />}
          <span className="hidden sm:inline">AI</span>
        </button>
        {scoped && (
          <Link
            href={`/?workspace=${encodeURIComponent(workspaceId!)}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-accent text-accent-fg hover:opacity-90 transition-opacity"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New chat</span>
          </Link>
        )}
      </div>

      {/* Pinned/scheduled chips */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => {
            const next = !pinnedOnly;
            setPinnedOnly(next);
            setChats([]);
            setOffset(0);
            setHasMore(true);
            fetchPage(0, next);
          }}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
            pinnedOnly
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
          )}
        >
          <Pin size={11} className={pinnedOnly ? 'fill-current' : ''} />
          Pinned
        </button>
        <button
          onClick={() => {
            const next: 'all' | 'scheduled' | 'unscheduled' =
              scheduledFilter === 'all'
                ? 'scheduled'
                : scheduledFilter === 'scheduled'
                  ? 'unscheduled'
                  : 'all';
            setScheduledFilter(next);
            setChats([]);
            setOffset(0);
            setHasMore(true);
            fetchPage(0, undefined, next);
          }}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
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
              <Spinner size="sm" />
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

      {loading && chats.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && !isSearchMode && chats.length === 0 && (
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
              <Spinner />
            </div>
          )}
          {!isSearchMode && <div ref={sentinelRef} className="h-1" />}
        </div>
      )}
    </div>
  );
};

export default ChatBrowser;
