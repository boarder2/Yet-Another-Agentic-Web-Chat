'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import ChatBrowser from '@/components/Chats/ChatBrowser';
import ArtifactBrowser from '@/components/Artifacts/ArtifactBrowser';
import PageHeader from '@/components/PageHeader';
import { FileCode2, History } from 'lucide-react';

type Tab = 'conversations' | 'artifacts';

function TabButton({
  tab,
  active,
  icon: Icon,
  label,
}: {
  tab: Tab;
  active: boolean;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Link
      href={{ pathname: '/history', query: { tab } }}
      replace
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-sm font-medium border transition-colors',
        active
          ? 'bg-accent/10 border-accent/30 text-accent'
          : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
      )}
    >
      <Icon size={15} />
      {label}
    </Link>
  );
}

const Page = () => {
  const searchParams = useSearchParams();
  const tab: Tab =
    searchParams.get('tab') === 'artifacts' ? 'artifacts' : 'conversations';
  return (
    <div>
      <PageHeader icon={History} title="History" />
      <div
        className="flex items-center gap-2 mb-4"
        role="tablist"
        aria-label="History"
      >
        <TabButton
          tab="conversations"
          active={tab === 'conversations'}
          icon={History}
          label="Conversations"
        />
        <TabButton
          tab="artifacts"
          active={tab === 'artifacts'}
          icon={FileCode2}
          label="Artifacts"
        />
      </div>
      {tab === 'artifacts' ? <ArtifactBrowser /> : <ChatBrowser />}
    </div>
  );
};

export default Page;
