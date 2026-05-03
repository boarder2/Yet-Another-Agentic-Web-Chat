// src/components/Workspaces/ChatsTab.tsx
'use client';

import ChatBrowser from '@/components/Chats/ChatBrowser';

const ChatsTab = ({ workspaceId }: { workspaceId: string }) => (
  <ChatBrowser workspaceId={workspaceId} />
);

export default ChatsTab;
