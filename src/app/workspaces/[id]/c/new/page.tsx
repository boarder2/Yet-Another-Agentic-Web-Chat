'use client';

import ChatWindow from '@/components/ChatWindow';
import { useWideWidth } from '@/components/Layout';
import { cn } from '@/lib/utils';
import { useParams } from 'next/navigation';

export default function Page() {
  const params = useParams<{ id: string }>();
  const wide = useWideWidth();

  return (
    <div className={cn(!wide && 'max-w-5xl lg:mx-auto mx-4')}>
      <ChatWindow workspaceId={params.id} />
    </div>
  );
}
