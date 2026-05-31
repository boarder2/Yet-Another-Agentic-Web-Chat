'use client';

import ChatWindow from '@/components/ChatWindow';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useMarkChatSeen } from '@/lib/hooks/api/useActiveRuns';

export default function Page() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId;
  const markSeen = useMarkChatSeen();

  useEffect(() => {
    markSeen.mutate(chatId);
    // markSeen is stable; only re-run when the chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  return <ChatWindow key={chatId} id={chatId} />;
}
