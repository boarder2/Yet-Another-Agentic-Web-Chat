'use client';

import {
  FolderOpen,
  MessageSquare,
  FileText,
  Link2,
  Brain,
  Settings,
  Loader2,
  ArrowLeft,
  BookOpen,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import FilesTab from '@/components/Workspaces/FilesTab';
import UrlsTab from '@/components/Workspaces/UrlsTab';
import ChatsTab from '@/components/Workspaces/ChatsTab';
import InstructionsTab from '@/components/Workspaces/InstructionsTab';
import SettingsTab from '@/components/Workspaces/SettingsTab';
import WorkspaceMemoryTab from '@/components/Workspaces/WorkspaceMemoryTab';

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  instructions: string | null;
  sourceUrls: string[];
  chatModel: { provider: string; name: string };
  systemModel: { provider: string; name: string } | null;
  defaultFocusMode: string | null;
  autoMemoryEnabled: 0 | 1 | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('chats');

  useEffect(() => {
    const fetchWorkspace = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/workspaces/${id}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspace(data.workspace);
        }
      } catch {
        console.error('Failed to fetch workspace');
      }
      setLoading(false);
    };
    fetchWorkspace();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <Loader2 size={24} className="animate-spin text-fg/40" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg gap-4">
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
    <div className="flex flex-col min-h-screen bg-bg">
      {/* Header */}
      <div className="border-b border-surface-2 bg-surface">
        <div className="max-w-screen-lg mx-auto px-4 sm:px-8 py-4">
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/workspaces"
              className="text-fg/50 hover:text-fg transition"
            >
              <ArrowLeft size={16} />
            </Link>
            <span className="text-lg">{workspace.icon ?? '📁'}</span>
            <h1 className="text-xl font-medium">{workspace.name}</h1>
            {workspace.archivedAt && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-surface-2 text-fg/50">
                Archived
              </span>
            )}
          </div>
          {workspace.description && (
            <p className="text-sm text-fg/50 ml-12">{workspace.description}</p>
          )}
        </div>

        {/* Tabs */}
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

      {/* Tab content */}
      <div className="max-w-screen-lg mx-auto px-4 sm:px-8 py-6 w-full flex-1">
        {activeTab === 'chats' && <ChatsTab workspaceId={id} />}
        {activeTab === 'files' && <FilesTab workspaceId={id} />}
        {activeTab === 'sources' && <UrlsTab workspaceId={id} />}
        {activeTab === 'instructions' && <InstructionsTab workspaceId={id} />}
        {activeTab === 'memory' && <WorkspaceMemoryTab workspaceId={id} />}
        {activeTab === 'settings' && <SettingsTab workspace={workspace} />}
      </div>
    </div>
  );
};

export default WorkspaceDetailPage;
