// src/app/library/page.tsx
'use client';

import ChatBrowser from '@/components/Chats/ChatBrowser';
import { BookOpenText } from 'lucide-react';

const Page = () => (
  <div>
    <div className="flex flex-col pt-4">
      <div className="flex items-center">
        <BookOpenText />
        <h1 className="text-3xl font-medium p-2">Library</h1>
      </div>
      <hr className="border-t border-surface-2 my-4 w-full" />
    </div>
    <ChatBrowser />
  </div>
);

export default Page;
