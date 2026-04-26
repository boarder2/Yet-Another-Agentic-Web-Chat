'use client';

import { formatTimeDifference } from '@/lib/utils';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Chat {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  messageCount?: number;
}

const ChatsTab = ({ workspaceId }: { workspaceId: string }) => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/chats?workspaceId=${encodeURIComponent(workspaceId)}&limit=50`)
      .then((r) => r.json())
      .then((d) => setChats(d.chats ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading) {
    return <div className="py-8 text-center text-fg/40 text-sm">Loading…</div>;
  }

  if (chats.length === 0) {
    return (
      <div className="py-8 text-center text-fg/40 text-sm">
        No chats in this workspace yet. Start a new chat and assign it here.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-surface-2">
      {chats.map((chat) => (
        <Link
          key={chat.id}
          href={`/c/${chat.id}`}
          className="flex items-center justify-between py-3 gap-3 hover:bg-surface rounded-lg px-2 -mx-2 transition-colors"
        >
          <span className="font-medium truncate">{chat.title}</span>
          <div className="flex items-center gap-2 text-xs text-fg/50 shrink-0">
            {typeof chat.messageCount === 'number' && (
              <span className="flex items-center gap-1">
                <MessageSquare size={11} />
                {chat.messageCount}
              </span>
            )}
            <span>
              {formatTimeDifference(new Date(), new Date(chat.createdAt))} ago
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default ChatsTab;
