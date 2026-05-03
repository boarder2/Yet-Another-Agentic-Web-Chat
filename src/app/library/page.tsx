// src/app/library/page.tsx
'use client';

import ChatBrowser from '@/components/Chats/ChatBrowser';
import PageHeader from '@/components/PageHeader';
import { BookOpenText } from 'lucide-react';

const Page = () => (
  <div>
    <PageHeader icon={BookOpenText} title="Library" />
    <ChatBrowser />
  </div>
);

export default Page;
