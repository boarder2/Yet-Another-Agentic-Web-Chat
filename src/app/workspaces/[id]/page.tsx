'use client';

import {
  FolderOpen,
  MessageSquare,
  FileText,
  Link2,
  Brain,
  Settings,
  LoaderCircle,
  BookOpen,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import FilesTab from '@/components/Workspaces/FilesTab';
import UrlsTab from '@/components/Workspaces/UrlsTab';
import ChatsTab from '@/components/Workspaces/ChatsTab';
import InstructionsTab from '@/components/Workspaces/InstructionsTab';
import SettingsTab from '@/components/Workspaces/SettingsTab';
import WorkspaceMemoryTab from '@/components/Workspaces/WorkspaceMemoryTab';
import { useWorkspace } from '@/lib/hooks/useWorkspace';

type TabId =
  | 'chats'
  | 'files'
  | 'sources'
  | 'instructions'
  | 'memory'
  | 'settings';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'sources', label: 'Sources', icon: Link2 },
  { id: 'instructions', label: 'Instructions', icon: BookOpen },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const WorkspaceDetailPage = () => {
  const params = useParams();
  const id = params.id as string;

  const { workspace, loading } = useWorkspace(id);
  const [activeTab, setActiveTab] = useState<TabId>('chats');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoaderCircle size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <FolderOpen size={48} className="text-fg/20" />
        <h2 className="text-lg font-medium text-fg/60">Workspace not found</h2>
        <Link
          href="/workspaces"
          className="text-accent text-sm hover:underline"
        >
          Back to workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Mobile: full tab layout for all sections */}
      <div className="lg:hidden flex flex-col flex-1">
        <div className="border-b border-surface-2 bg-surface">
          <div className="max-w-screen-lg mx-auto px-4 sm:px-8">
            <div className="flex gap-1 overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap',
                    activeTab === tab.id
                      ? 'border-accent text-fg font-medium'
                      : 'border-transparent text-fg/50 hover:text-fg',
                  )}
                >
                  <tab.icon size={14} />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="max-w-screen-lg mx-auto px-4 sm:px-8 py-6 w-full flex-1 overflow-auto">
          {activeTab === 'chats' && <ChatsTab workspaceId={id} />}
          {activeTab === 'files' && <FilesTab workspaceId={id} />}
          {activeTab === 'sources' && <UrlsTab workspaceId={id} />}
          {activeTab === 'instructions' && <InstructionsTab workspaceId={id} />}
          {activeTab === 'memory' && <WorkspaceMemoryTab workspaceId={id} />}
          {activeTab === 'settings' && <SettingsTab workspace={workspace} />}
        </div>
      </div>

      {/* Desktop: chat browser in main area (sidebar is provided by WorkspaceShell layout) */}
      <div className="hidden lg:block px-8 py-6">
        <ChatsTab workspaceId={id} />
      </div>
    </div>
  );
};

export default WorkspaceDetailPage;
