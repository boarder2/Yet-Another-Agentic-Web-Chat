'use client';

import { cn } from '@/lib/utils';
import {
  BookOpenText,
  Brain,
  Home,
  SquarePen,
  Settings,
  LayoutDashboard,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';
import React, { type ReactNode } from 'react';
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

  const navLinks = [
    {
      icon: Home,
      href: '/',
      active: segments.length === 0 || segments.includes('c'),
      label: 'Home',
    },
    {
      icon: LayoutDashboard,
      href: '/dashboard',
      active: segments.includes('dashboard'),
      label: 'Dashboard',
    },
    {
      icon: BookOpenText,
      href: '/library',
      active: segments.includes('library'),
      label: 'Library',
    },
    {
      icon: Brain,
      href: '/memory',
      active: segments.includes('memory'),
      label: 'Memory',
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
            <link.icon />
            <p className="text-xs">{link.label}</p>
          </Link>
        ))}
      </div>

      <Layout>{children}</Layout>
    </div>
  );
};

export default Sidebar;
