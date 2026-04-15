'use client';

import { cn } from '@/lib/utils';
import {
  BookOpenText,
  Brain,
  CalendarClock,
  Home,
  SquarePen,
  Settings,
  LayoutDashboard,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';
import React, { useEffect, useState, type ReactNode } from 'react';
import Layout, { setWideWidth, useWideWidth } from './Layout';

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

const NewChatButtonMobile = () => (
  <div className="flex flex-col items-center space-y-1 text-center w-full">
    <Link href="/" className="cursor-pointer">
      <SquarePen size={20} />
    </Link>
    <p className="text-xs">New</p>
  </div>
);

const WidthToggle = () => {
  const segments = useSelectedLayoutSegments();
  const isChat = segments[0] === 'c';
  const wide = useWideWidth();

  if (!isChat) return null;

  return (
    <button
      type="button"
      onClick={() => setWideWidth(!wide)}
      aria-label={wide ? 'Switch to narrow width' : 'Switch to full width'}
      title={wide ? 'Narrow width' : 'Full width'}
      className="flex items-center justify-center w-full py-2 rounded-lg text-fg/70 hover:text-fg hover:bg-surface-2 duration-150 transition"
    >
      {wide ? <Minimize2 /> : <Maximize2 />}
    </button>
  );
};

const Sidebar = ({ children }: { children: React.ReactNode }) => {
  const segments = useSelectedLayoutSegments();
  const [scheduledUnread, setScheduledUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const r = await fetch('/api/scheduled-tasks/runs/unread');
        if (!r.ok) return;
        const { count } = await r.json();
        if (!cancelled) setScheduledUnread(count);
      } catch {
        // Ignore
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    const onFocus = () => fetchCount();
    const onCustom = (e: Event) => {
      const c = (e as CustomEvent).detail?.count;
      if (typeof c === 'number') setScheduledUnread(c);
      else fetchCount();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('scheduled-runs-unread-changed', onCustom);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('scheduled-runs-unread-changed', onCustom);
    };
  }, []);

  const navLinks = [
    {
      icon: Home,
      href: '/',
      active: segments.length === 0 || segments.includes('c'),
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
      icon: BookOpenText,
      href: '/library',
      active: segments.includes('library'),
      label: 'Library',
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
      icon: Brain,
      href: '/memory',
      active: segments.includes('memory'),
      label: 'Memory',
      badgeCount: 0,
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
                    'relative flex flex-row items-center justify-center cursor-pointer hover:bg-surface-2 duration-150 transition w-full py-2 rounded-lg',
                    link.active ? 'text-fg' : 'text-fg/70',
                  )}
                >
                  <link.icon />
                  {link.badgeCount > 0 && (
                    <span className="absolute top-0.5 right-2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold leading-none px-1">
                      {link.badgeCount > 99 ? '99+' : link.badgeCount}
                    </span>
                  )}
                  {link.active && (
                    <div className="absolute right-0 -mr-2 h-full w-1 rounded-l-lg bg-accent" />
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
                className="flex items-center justify-center w-full py-2 rounded-lg text-fg/70 hover:text-fg hover:bg-surface-2 duration-150 transition"
              >
                <Settings />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 w-full z-50 flex flex-row items-center gap-x-6 bg-bg px-4 py-4 shadow-sm lg:hidden">
        <NewChatButtonMobile />
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
              <div className="absolute top-0 -mt-4 h-1 w-full rounded-b-lg bg-accent" />
            )}
            <div className="relative">
              <link.icon />
              {link.badgeCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-accent text-white text-[9px] font-bold leading-none px-0.5">
                  {link.badgeCount > 99 ? '99+' : link.badgeCount}
                </span>
              )}
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
