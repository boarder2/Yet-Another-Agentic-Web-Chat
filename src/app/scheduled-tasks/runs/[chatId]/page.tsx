'use client';

import ChatWindow from '@/components/ChatWindow';
import React, { useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function ScheduledRunPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId;

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

  return <ChatWindow key={chatId} id={chatId} />;
}
