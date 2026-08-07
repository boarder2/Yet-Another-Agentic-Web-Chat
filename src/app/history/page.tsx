'use client';

import { useSearchParams } from 'next/navigation';
import ChatBrowser from '@/components/Chats/ChatBrowser';
import ArtifactBrowser from '@/components/Artifacts/ArtifactBrowser';
import PageHeader from '@/components/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { FileCode2, History } from 'lucide-react';

type Tab = 'conversations' | 'artifacts';

const Page = () => {
  const searchParams = useSearchParams();
  const tab: Tab =
    searchParams.get('tab') === 'artifacts' ? 'artifacts' : 'conversations';
  return (
    <div>
      <PageHeader icon={History} title="History" />
      <Tabs
        className="mb-4"
        aria-label="History"
        activeKey={tab}
        items={[
          {
            key: 'conversations',
            label: 'Conversations',
            icon: History,
            href: '/history?tab=conversations',
            replace: true,
          },
          {
            key: 'artifacts',
            label: 'Artifacts',
            icon: FileCode2,
            href: '/history?tab=artifacts',
            replace: true,
          },
        ]}
      />
      {tab === 'artifacts' ? <ArtifactBrowser /> : <ChatBrowser />}
    </div>
  );
};

export default Page;
