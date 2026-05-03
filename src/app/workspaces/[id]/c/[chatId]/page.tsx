'use client';

import ChatWindow from '@/components/ChatWindow';
import { useWideWidth } from '@/components/Layout';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function Page() {
  const params = useParams<{ id: string; chatId: string }>();
  const { id, chatId } = params;
  const wide = useWideWidth();

  useEffect(() => {
    fetch(`/api/scheduled-tasks/runs/${chatId}/view`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        window.dispatchEvent(
          new CustomEvent('scheduled-runs-unread-changed', { detail: d }),
        );
      })
      .catch(() => {});
  }, [chatId]);

  return (
    <div className={cn(!wide && 'max-w-5xl lg:mx-auto mx-4')}>
      <ChatWindow key={chatId} id={chatId} workspaceId={id} />
    </div>
  );
}
