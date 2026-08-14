'use client';

import {
  ChevronDown,
  ChevronRight,
  FileText,
  FileCode2,
  BookOpen,
  Brain,
  Settings as SettingsIcon,
  Plus,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/IconButton';
import FilesTab from './FilesTab';
import ArtifactsTab from './ArtifactsTab';
import InstructionsTab from './InstructionsTab';
import WorkspaceMemoryTab from './WorkspaceMemoryTab';
import SettingsTab from './SettingsTab';
import FileViewer from './FileViewer';
import Modal from '@/components/ui/Modal';
import { Card } from '@/components/ui/Card';
import { ListLoading } from '@/components/ui/List';
import { useWorkspace } from '@/lib/hooks/api/useWorkspaces';
import { useWorkspaceFiles } from '@/lib/hooks/api/useWorkspaceFiles';
import { useWorkspaceArtifacts } from '@/lib/hooks/api/useArtifacts';
import { useWorkspaceMemory } from '@/lib/hooks/api/useWorkspaceMemory';
import { useWorkspaceSystemPrompts } from '@/lib/hooks/api/useWorkspaceSystemPrompts';

type SectionKey = 'files' | 'artifacts' | 'instructions' | 'memory';

function CollapsibleSection({
  icon: Icon,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card data-workspace-section radius="floating" className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full border border-transparent flex items-center gap-2 px-3 py-2.5 hover:bg-surface-2 transition-colors duration-150 text-left focus-border-neutral"
      >
        {open ? (
          <ChevronDown size={14} className="text-fg-subtle shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-fg-subtle shrink-0" />
        )}
        <Icon size={14} className="text-fg-muted shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">{title}</span>
        <span className="text-xs text-fg-subtle shrink-0">{summary}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-surface-2">
          {children}
        </div>
      )}
    </Card>
  );
}

export default function WorkspaceSidebar({
  workspaceId,
  className,
  collapsed,
  onToggleCollapse,
}: {
  workspaceId: string;
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: files } = useWorkspaceFiles(workspaceId);
  const { data: artifacts } = useWorkspaceArtifacts(workspaceId);
  const { data: memories } = useWorkspaceMemory(workspaceId);
  const { data: linkedPromptIds } = useWorkspaceSystemPrompts(workspaceId);

  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    files: false,
    artifacts: false,
    instructions: false,
    memory: false,
  });

  const [openFile, setOpenFile] = useState<{
    id: string;
    edit: boolean;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function toggle(k: SectionKey) {
    setOpen((o) => ({ ...o, [k]: !o[k] }));
  }

  const fileCount = files?.length ?? null;
  const artifactCount = artifacts?.length ?? null;
  const memoryCount = memories?.length ?? null;
  const instructionsLength = workspace?.instructions?.length ?? null;
  const linkedCount = linkedPromptIds?.length ?? null;

  const filesSummary =
    fileCount === null ? '…' : `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  const artifactsSummary =
    artifactCount === null
      ? '…'
      : `${artifactCount} artifact${artifactCount === 1 ? '' : 's'}`;
  const memorySummary =
    memoryCount === null
      ? '…'
      : `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}`;
  const instructionsSummary = (() => {
    if (instructionsLength === null) return '…';
    const linked = linkedCount ?? 0;
    if (instructionsLength === 0 && linked === 0) return 'empty';
    const parts: string[] = [];
    if (instructionsLength > 0) parts.push(`${instructionsLength} chars`);
    if (linked > 0) parts.push(`${linked} prompt${linked === 1 ? '' : 's'}`);
    return parts.join(' · ');
  })();

  const settingsModal = (
    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Workspace settings"
      size="md"
    >
      {workspace ? (
        <SettingsTab workspace={workspace} />
      ) : (
        <ListLoading layout="section" size={20} />
      )}
    </Modal>
  );

  return (
    <>
      {collapsed ? (
        <aside
          className={cn(
            'shrink-0 bg-bg flex flex-col items-center h-full px-4',
            className,
          )}
        >
          <div className="pt-3 flex flex-col items-center gap-1.5">
            {/* Absent when the caller has no room to expand into. */}
            {onToggleCollapse && (
              <IconButton
                icon={PanelRightOpen}
                label="Expand sidebar"
                onClick={onToggleCollapse}
              />
            )}
            <IconButton
              href={`/workspaces/${workspaceId}/c/new`}
              icon={Plus}
              label="New chat"
              tone="primary"
            />
          </div>

          <div className="mt-auto pb-4">
            <IconButton
              icon={SettingsIcon}
              label="Workspace settings"
              onClick={() => setSettingsOpen(true)}
            />
          </div>
        </aside>
      ) : (
        <aside
          className={cn(
            'shrink-0 bg-bg flex flex-col h-full overflow-hidden',
            className,
          )}
        >
          <div className="flex justify-between items-center gap-2 px-4 py-2">
            <IconButton
              href={`/workspaces/${workspaceId}/c/new`}
              icon={Plus}
              label="New chat"
              tone="primary"
              className="p-2"
            />

            <div className="flex gap-2 items-center">
              <IconButton
                icon={SettingsIcon}
                label="Workspace settings"
                onClick={() => setSettingsOpen(true)}
                className="p-2"
              />
              <IconButton
                icon={PanelRightClose}
                label="Collapse sidebar"
                onClick={onToggleCollapse}
                className="p-2"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto px-3 py-3 space-y-2">
            <CollapsibleSection
              icon={FileText}
              title="Files"
              summary={filesSummary}
              open={open.files}
              onToggle={() => toggle('files')}
            >
              <FilesTab
                workspaceId={workspaceId}
                compact
                onOpenFile={(id, edit) => setOpenFile({ id, edit: !!edit })}
              />
            </CollapsibleSection>

            <CollapsibleSection
              icon={FileCode2}
              title="Artifacts"
              summary={artifactsSummary}
              open={open.artifacts}
              onToggle={() => toggle('artifacts')}
            >
              <ArtifactsTab workspaceId={workspaceId} />
            </CollapsibleSection>

            <CollapsibleSection
              icon={BookOpen}
              title="Instructions"
              summary={instructionsSummary}
              open={open.instructions}
              onToggle={() => toggle('instructions')}
            >
              <InstructionsTab workspaceId={workspaceId} />
            </CollapsibleSection>

            <CollapsibleSection
              icon={Brain}
              title="Memory"
              summary={memorySummary}
              open={open.memory}
              onToggle={() => toggle('memory')}
            >
              <WorkspaceMemoryTab workspaceId={workspaceId} compact />
            </CollapsibleSection>
          </div>

          <Modal
            open={!!openFile}
            onClose={() => setOpenFile(null)}
            title="File"
            size="lg"
          >
            {openFile && (
              <FileViewer
                key={openFile.id}
                workspaceId={workspaceId}
                fileId={openFile.id}
                startEditing={openFile.edit}
              />
            )}
          </Modal>
        </aside>
      )}

      {settingsModal}
    </>
  );
}
