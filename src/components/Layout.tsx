'use client';

import { useSelectedLayoutSegments } from 'next/navigation';
import { useEffect } from 'react';
import {
  useLocalStorageBoolean,
  writeLocalStorage,
} from '@/lib/hooks/useLocalStorage';

export const WIDTH_STORAGE_KEY = 'chatWidthWide';

export const useWideWidth = () => {
  const [value] = useLocalStorageBoolean(WIDTH_STORAGE_KEY, false);
  return value;
};

export const setWideWidth = (next: boolean) => {
  writeLocalStorage(WIDTH_STORAGE_KEY, next ? 'true' : 'false');
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const segments = useSelectedLayoutSegments();
  const isDashboard = segments.includes('dashboard');
  // The root path ('/') also renders a ChatWindow (new chat). The URL is later
  // updated to /c/<id> via history.replaceState (not Next.js navigation), so
  // useSelectedLayoutSegments never sees the change. Treat segments.length === 0
  // (home page) as a chat route so the wide-width setting works from the start.
  const isChat = segments[0] === 'c' || segments.length === 0;
  const isWorkspaceChat =
    segments[0] === 'workspaces' && segments.includes('c');
  const isWorkspaceDetail = segments[0] === 'workspaces' && segments.length > 1;
  const wide = useWideWidth();
  const wideActive = isChat && wide;

  useEffect(() => {
    if (!isChat && !isWorkspaceChat) return;
    window.dispatchEvent(new Event('resize'));
  }, [wide, isChat, isWorkspaceChat]);

  const containerClass = isDashboard
    ? 'mx-4'
    : isWorkspaceDetail
      ? ''
      : wideActive
        ? 'mx-4'
        : 'max-w-screen-lg lg:mx-auto mx-4';

  return (
    <main className="lg:pl-20 bg-bg min-h-screen">
      <div className={containerClass}>{children}</div>
    </main>
  );
};

export default Layout;
