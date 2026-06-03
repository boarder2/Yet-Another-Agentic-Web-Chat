'use client';

import { cn } from '@/lib/utils';
import {
  CalendarClock,
  Ellipsis,
  Home,
  SquarePen,
  Settings,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  History,
  Briefcase,
} from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';
import React, { Fragment, useEffect, useRef, type ReactNode } from 'react';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
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

interface NavLink {
  icon: React.ComponentType<{ size?: number }>;
  href: string;
  active: boolean;
  label: string;
  badgeCount: number;
}

const MoreMenu = ({ links }: { links: NavLink[] }) => {
  const hasActive = links.some((l) => l.active);

  return (
    <Popover className="relative">
      <PopoverButton
        className={cn(
          'relative flex flex-col items-center space-y-1 text-center w-full',
          hasActive ? 'text-fg' : 'text-fg/70',
        )}
      >
        {hasActive && (
          <div className="absolute top-0 -mt-4 h-1 w-full rounded-b-surface bg-accent" />
        )}
        <Ellipsis size={20} />
        <p className="text-xs">More</p>
      </PopoverButton>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <PopoverPanel className="absolute right-0 z-20 w-48 transform bottom-full mb-2">
          <div className="overflow-hidden rounded-surface shadow-raised ring-1 ring-surface-2 bg-surface">
            <div className="p-1.5">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'flex items-center gap-2.5 p-2.5 rounded-control hover:bg-surface-2',
                    link.active ? 'text-accent' : 'text-fg/70',
                  )}
                >
                  <link.icon size={18} />
                  <span className="text-sm">{link.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
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

  const navLinks = [
    {
      icon: Home,
      href: '/',
      active:
        (segments.length === 0 || segments.includes('c')) &&
        !segments.includes('workspaces'),
      label: 'Home',
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
        {(() => {
          const primaryLabels = new Set(['Home', 'Dashboard', 'Scheduled']);
          const primaryLinks = navLinks.filter((l) =>
            primaryLabels.has(l.label),
          );
          const overflowLinks = navLinks.filter(
            (l) => !primaryLabels.has(l.label),
          );
          return (
            <>
              {primaryLinks.map((link, i) => (
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
                    {link.badgeCount > 0 && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-pill bg-accent text-accent-fg text-[9px] font-bold leading-none px-0.5">
                        {link.badgeCount > 99 ? '99+' : link.badgeCount}
                      </span>
                    )}
                  </div>
                  <p className="text-xs">{link.label}</p>
                </Link>
              ))}
              <MoreMenu links={overflowLinks} />
            </>
          );
        })()}
      </div>

      <Layout>{children}</Layout>
    </div>
  );
};

export default Sidebar;
