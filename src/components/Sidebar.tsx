'use client';

import { cn } from '@/lib/utils';
import {
  CalendarClock,
  SquarePen,
  Settings,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  History,
  Briefcase,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';
import React, { useEffect, useRef, type ReactNode } from 'react';
import Layout, { setWideWidth, useWideWidth } from './Layout';
import { useActiveRuns } from '@/lib/hooks/api/useActiveRuns';
import { useScheduledRunsUnread } from '@/lib/hooks/api/useScheduledTasks';
import { qk } from '@/lib/api/keys';
import { useQueryClient } from '@tanstack/react-query';

const VerticalIconContainer = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex flex-col items-center gap-y-3 w-full">{children}</div>
  );
};

const NewChatButton = () => (
  <Link href="/" className="cursor-pointer">
    <SquarePen />
  </Link>
);

const WidthToggle = () => {
  const segments = useSelectedLayoutSegments();
  // Show on /c/[id] routes and workspace chat routes (/workspaces/[id]/c/...).
  const isChat = segments.some((s) => s === 'c');
  const wide = useWideWidth();

  if (!isChat) return null;

  return (
    <button
      type="button"
      onClick={() => setWideWidth(!wide)}
      aria-label={wide ? 'Switch to narrow width' : 'Switch to full width'}
      title={wide ? 'Narrow width' : 'Full width'}
      className="flex items-center justify-center w-full py-2 rounded-surface text-fg/70 hover:text-fg hover:bg-surface-2 duration-150 transition"
    >
      {wide ? <Minimize2 /> : <Maximize2 />}
    </button>
  );
};

const Sidebar = ({ children }: { children: React.ReactNode }) => {
  const segments = useSelectedLayoutSegments();
  const qc = useQueryClient();

  // Scheduled badge: shared TanStack query (polls + refetches on focus/mount).
  const { data: scheduledUnread = 0 } = useScheduledRunsUnread();

  // Mark-seen flows dispatch this with an authoritative count; write it
  // straight into the cache so the badge updates without a round-trip,
  // falling back to a refetch when no count is provided.
  useEffect(() => {
    const onScheduled = (e: Event) => {
      const c = (e as CustomEvent).detail?.count;
      if (typeof c === 'number')
        qc.setQueryData(qk.scheduledRunsUnread, { count: c });
      else qc.invalidateQueries({ queryKey: qk.scheduledRunsUnread });
    };
    window.addEventListener('scheduled-runs-unread-changed', onScheduled);
    return () =>
      window.removeEventListener('scheduled-runs-unread-changed', onScheduled);
  }, [qc]);

  // History badge: driven by useActiveRuns (single shared polling loop).
  const { data: activeRunsData } = useActiveRuns();
  const prevActiveChatIds = useRef<Set<string>>(new Set());

  // Detect completions and invalidate the chats list when runs transition out.
  useEffect(() => {
    if (!activeRunsData) return;

    const currentIds = new Set(activeRunsData.active.map((r) => r.chatId));
    const prev = prevActiveChatIds.current;
    const hasTransitions =
      [...prev].some((id) => !currentIds.has(id)) ||
      activeRunsData.stale.length > 0;

    if (hasTransitions) {
      qc.invalidateQueries({ queryKey: qk.chatsInfiniteRoot });
    }

    prevActiveChatIds.current = currentIds;
  }, [activeRunsData, qc]);

  // On open-chat seen event, trigger an immediate activeRuns refetch so the
  // badge reflects the updated unreadCount without waiting for the next poll.
  useEffect(() => {
    const onHistory = () => {
      qc.invalidateQueries({ queryKey: ['active-runs'] });
    };
    window.addEventListener('history-runs-unread-changed', onHistory);
    return () =>
      window.removeEventListener('history-runs-unread-changed', onHistory);
  }, [qc]);

  const historyUnread = activeRunsData?.unreadCount ?? 0;
  const awaitingAttentionCount = activeRunsData?.awaitingAttentionCount ?? 0;

  // The chat currently open (if any): segments look like ['c', id] or
  // ['workspaces', wsId, 'c', id]. A run for this chat is already visible in
  // the ChatWindow, so it shouldn't drive the sidebar's in-progress flare.
  const cIndex = segments.indexOf('c');
  const currentChatId = cIndex >= 0 ? segments[cIndex + 1] : undefined;

  // Navigating into/out of a chat changes which run is excluded from the
  // in-progress flare above. Refetch immediately so a run we just backgrounded
  // (or returned to) is reflected at once instead of waiting for the next poll.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: qk.activeRuns });
  }, [currentChatId, qc]);

  const runningCount = (activeRunsData?.active ?? []).filter(
    (r) => r.status === 'running' && r.chatId !== currentChatId,
  ).length;
  // Finished/awaiting badges take precedence; the in-progress flare only shows
  // when nothing finished is competing for the History icon's corner slot.
  const historyInProgress =
    awaitingAttentionCount === 0 && historyUnread === 0 && runningCount > 0;

  const navLinks = [
    {
      // Highlights while you're in a chat thread (or on the new-chat screen);
      // tapping it returns to / and starts a fresh chat. On mobile this is also
      // the primary new-chat entry point (there's no separate New button there).
      icon: MessageSquare,
      href: '/',
      active:
        (segments.length === 0 || segments.includes('c')) &&
        !segments.includes('workspaces'),
      label: 'Chat',
      badgeCount: 0,
    },
    {
      icon: LayoutDashboard,
      href: '/dashboard',
      active: segments.includes('dashboard'),
      label: 'Dashboard',
      badgeCount: 0,
    },
    {
      icon: Briefcase,
      href: '/workspaces',
      active: segments.includes('workspaces'),
      label: 'Workspaces',
      badgeCount: 0,
    },
    {
      icon: CalendarClock,
      href: '/scheduled-tasks',
      active: segments.includes('scheduled-tasks'),
      label: 'Scheduled',
      badgeCount: scheduledUnread,
    },
    {
      icon: History,
      href: '/history',
      active: segments.includes('history'),
      label: 'History',
      badgeCount: historyUnread,
    },
  ];

  return (
    <div>
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-20 lg:flex-col">
        <div className="relative flex grow flex-col items-center overflow-y-auto bg-surface px-2 py-8">
          <div className="flex-1 flex items-start justify-center w-full">
            <NewChatButton />
          </div>
          <div className="flex-1 flex items-center justify-center w-full">
            <VerticalIconContainer>
              {navLinks.map((link, i) => (
                <Link
                  key={i}
                  href={link.href}
                  className={cn(
                    'relative flex flex-row items-center justify-center cursor-pointer hover:bg-surface-2 duration-150 transition w-full py-2 rounded-surface',
                    link.active ? 'text-fg' : 'text-fg/70',
                  )}
                >
                  <link.icon />
                  {link.label === 'History' && awaitingAttentionCount > 0 ? (
                    <span className="absolute top-0.5 right-0.5 flex gap-0.5">
                      <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-pill bg-warning text-warning-fg text-[10px] font-bold leading-none px-1">
                        {awaitingAttentionCount > 99
                          ? '99+'
                          : awaitingAttentionCount}
                      </span>
                      {historyUnread > 0 && (
                        <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-pill bg-accent text-accent-fg text-[10px] font-bold leading-none px-1">
                          {historyUnread > 99 ? '99+' : historyUnread}
                        </span>
                      )}
                    </span>
                  ) : link.badgeCount > 0 ? (
                    <span className="absolute top-0.5 right-2 min-w-[18px] h-[18px] flex items-center justify-center rounded-pill bg-accent text-accent-fg text-[10px] font-bold leading-none px-1">
                      {link.badgeCount > 99 ? '99+' : link.badgeCount}
                    </span>
                  ) : link.label === 'History' && historyInProgress ? (
                    <span className="absolute top-0 right-1 flex h-4 w-4 items-center justify-center animate-badge-pop">
                      <span className="absolute inline-flex h-full w-full rounded-pill bg-accent/50 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-pill bg-accent" />
                    </span>
                  ) : null}
                  {link.active && (
                    <div className="absolute right-0 -mr-2 h-full w-1 rounded-l-surface bg-accent" />
                  )}
                </Link>
              ))}
            </VerticalIconContainer>
          </div>
          <div className="flex-1 flex items-end justify-center w-full">
            <div className="flex flex-col items-center gap-y-3 w-full -mb-2">
              <WidthToggle />
              <Link
                href="/settings"
                className="flex items-center justify-center w-full py-2 rounded-surface text-fg/70 hover:text-fg hover:bg-surface-2 duration-150 transition"
              >
                <Settings />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 w-full z-50 flex flex-row items-center gap-x-6 bg-bg px-4 py-4 shadow-resting lg:hidden">
        {/* Every destination directly, no overflow menu. The leading Chat item
            doubles as the new-chat tap target (no separate New button here). */}
        {navLinks.map((link, i) => (
          <Link
            href={link.href}
            key={i}
            className={cn(
              'relative flex flex-col items-center space-y-1 text-center w-full',
              link.active ? 'text-fg' : 'text-fg/70',
            )}
          >
            {link.active && (
              <div className="absolute top-0 -mt-4 h-1 w-full rounded-b-surface bg-accent" />
            )}
            <div className="relative">
              <link.icon />
              {link.label === 'History' && historyInProgress ? (
                <span className="absolute -top-1 -right-2 flex h-3.5 w-3.5 items-center justify-center animate-badge-pop">
                  <span className="absolute inline-flex h-full w-full rounded-pill bg-accent/50 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-pill bg-accent" />
                </span>
              ) : link.badgeCount > 0 ? (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-pill bg-accent text-accent-fg text-[9px] font-bold leading-none px-0.5">
                  {link.badgeCount > 99 ? '99+' : link.badgeCount}
                </span>
              ) : null}
            </div>
            <p className="text-xs">{link.label}</p>
          </Link>
        ))}
      </div>

      <Layout>{children}</Layout>
    </div>
  );
};

export default Sidebar;
