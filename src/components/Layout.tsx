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
  const isChat = segments[0] === 'c';
  const wide = useWideWidth();
  const wideActive = isChat && wide;

  useEffect(() => {
    if (!isChat) return;
    window.dispatchEvent(new Event('resize'));
  }, [wide, isChat]);

  const containerClass = isDashboard
    ? 'mx-4'
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
