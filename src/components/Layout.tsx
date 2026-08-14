'use client';

import { useSelectedLayoutSegments } from 'next/navigation';
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
  const isCapabilityDocs =
    segments[0] === 'docs' && segments[1] === 'capabilities';
  // The root path ('/') also renders a ChatWindow (new chat). The URL is later
  // updated to /c/<id> via history.replaceState (not Next.js navigation), so
  // useSelectedLayoutSegments never sees the change. Treat segments.length === 0
  // (home page) as a chat route so the wide-width setting works from the start.
  const isChat = segments[0] === 'c' || segments.length === 0;
  const isWorkspaceDetail = segments[0] === 'workspaces' && segments.length > 1;
  const wide = useWideWidth();
  const wideActive = isChat && wide;

  const containerClass =
    isDashboard || isCapabilityDocs
      ? 'mx-4'
      : isWorkspaceDetail
        ? ''
        : wideActive
          ? 'mx-4'
          : // `--chat-ml` is `auto` until the artifact panel opens, which pins the
            // column beside the sidebar instead so its text doesn't slide sideways
            // as the panel is dragged.
            'max-w-screen-lg mx-4 lg:ml-(--chat-ml) lg:mr-auto';

  return (
    // `--artifact-inset` reserves the docked artifact panel's width.
    <main className="lg:pl-20 md:pr-(--artifact-inset) bg-bg min-h-screen">
      <div className={containerClass}>{children}</div>
    </main>
  );
};

export default Layout;
