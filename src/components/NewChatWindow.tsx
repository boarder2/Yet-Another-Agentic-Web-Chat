'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import ChatWindow from './ChatWindow';

// A "new chat" ChatWindow lives at a root path (e.g. "/" or
// "/workspaces/{id}/c/new"). After the first message, ChatWindow rewrites the
// URL to /c/{chatId} in place via history.replaceState rather than a route
// navigation, so the streaming instance is never unmounted (avoids a mid-stream
// flicker — see ChatWindow.sendMessage). The trade-off: the rendered tree is
// still this page, so navigating back to the root (New/Home buttons) reconciles
// the same ChatWindow instance and would keep the previous conversation. Bump a
// key whenever the user returns to the root path so a fresh, blank chat mounts.
const NewChatWindow = ({
  rootPath,
  workspaceId,
}: {
  rootPath: string;
  workspaceId?: string;
}) => {
  const pathname = usePathname();
  const [resetKey, setResetKey] = useState(0);
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname === rootPath && prevPath.current !== rootPath) {
      setResetKey((k) => k + 1);
    }
    prevPath.current = pathname;
  }, [pathname, rootPath]);

  return <ChatWindow key={resetKey} workspaceId={workspaceId} />;
};

export default NewChatWindow;
