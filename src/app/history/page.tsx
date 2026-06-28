// src/app/history/page.tsx
'use client';

import ChatBrowser from '@/components/Chats/ChatBrowser';
import PageHeader from '@/components/PageHeader';
import { History } from 'lucide-react';

const Page = () => (
  <div>
    <PageHeader icon={History} title="History" />
    <ChatBrowser />
  </div>
);

export default Page;
