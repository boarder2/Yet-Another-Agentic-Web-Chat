'use client';

import ChatWindow from '@/components/ChatWindow';
import { useWideWidth } from '@/components/Layout';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useMarkChatSeen } from '@/lib/hooks/api/useActiveRuns';

export default function Page() {
  const params = useParams<{ id: string; chatId: string }>();
  const { id, chatId } = params;
  const wide = useWideWidth();
  const markSeen = useMarkChatSeen();

  useEffect(() => {
    markSeen.mutate(chatId);
    // markSeen is stable; only re-run when the chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  return (
    <div className={cn(!wide && 'max-w-5xl lg:mx-auto mx-4')}>
      <ChatWindow key={chatId} id={chatId} workspaceId={id} />
    </div>
  );
}
