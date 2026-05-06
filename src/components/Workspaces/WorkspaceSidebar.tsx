'use client';

import {
  ChevronDown,
  ChevronRight,
  FileText,
  Link2,
  BookOpen,
  Brain,
  Settings as SettingsIcon,
  LoaderCircle,
  Plus,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import FilesTab from './FilesTab';
import UrlsTab from './UrlsTab';
import InstructionsTab from './InstructionsTab';
import WorkspaceMemoryTab from './WorkspaceMemoryTab';
import SettingsTab from './SettingsTab';
import FileViewer from './FileViewer';
import WorkspaceModal from './WorkspaceModal';
import { useWorkspace } from '@/lib/hooks/useWorkspace';

type SectionKey = 'files' | 'sources' | 'instructions' | 'memory';

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
    <section className="border border-surface-2 rounded-floating bg-surface overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-surface-2 transition text-left"
      >
        {open ? (
          <ChevronDown size={14} className="text-fg/40 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-fg/40 shrink-0" />
        )}
        <Icon size={14} className="text-fg/60 shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">{title}</span>
        <span className="text-xs text-fg/50 shrink-0">{summary}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-surface-2">
          {children}
        </div>
      )}
    </section>
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
  const { workspace } = useWorkspace(workspaceId);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    files: false,
    sources: false,
    instructions: false,
    memory: false,
  });
  const [counts, setCounts] = useState({
    files: null as number | null,
    sources: null as number | null,
    memory: null as number | null,
    instructionsLength: null as number | null,
    instructionsLinked: null as number | null,
  });

  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Listen for workspace-updated events to re-fetch counts
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ workspaceId: string }>).detail;
      if (detail?.workspaceId === workspaceId) {
        setCounts({
          files: null,
          sources: null,
          memory: null,
          instructionsLength: null,
          instructionsLinked: null,
        });
        setRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('workspace-updated', handler);
    return () => window.removeEventListener('workspace-updated', handler);
  }, [workspaceId]);

  // When a section is collapsed, fetch its count once so the summary is meaningful.
  useEffect(() => {
    if (counts.files === null) {
      fetch(`/api/workspaces/${workspaceId}/files`)
        .then((r) => r.json())
        .then((d) =>
          setCounts((c) => ({ ...c, files: (d.files ?? []).length })),
        )
        .catch(() => {});
    }
    if (counts.sources === null) {
      fetch(`/api/workspaces/${workspaceId}/urls`)
        .then((r) => r.json())
        .then((d) =>
          setCounts((c) => ({ ...c, sources: (d.urls ?? []).length })),
        )
        .catch(() => {});
    }
    if (counts.memory === null) {
      fetch(`/api/memories?workspaceId=${workspaceId}&limit=1`)
        .then((r) => r.json())
        .then((d) =>
          setCounts((c) => ({
            ...c,
            memory:
              typeof d.total === 'number' ? d.total : (d.data ?? []).length,
          })),
        )
        .catch(() => {});
    }
    if (counts.instructionsLength === null) {
      Promise.all([
        fetch(`/api/workspaces/${workspaceId}`).then((r) => r.json()),
        fetch(`/api/workspaces/${workspaceId}/system-prompts`).then((r) =>
          r.json(),
        ),
      ])
        .then(([ws, links]) =>
          setCounts((c) => ({
            ...c,
            instructionsLength: (ws.workspace?.instructions ?? '').length,
            instructionsLinked: (links.links ?? []).length,
          })),
        )
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, refreshKey]);

  function toggle(k: SectionKey) {
    setOpen((o) => ({ ...o, [k]: !o[k] }));
  }

  const filesSummary =
    counts.files === null
      ? '…'
      : `${counts.files} file${counts.files === 1 ? '' : 's'}`;
  const sourcesSummary =
    counts.sources === null
      ? '…'
      : `${counts.sources} URL${counts.sources === 1 ? '' : 's'}`;
  const memorySummary =
    counts.memory === null
      ? '…'
      : `${counts.memory} ${counts.memory === 1 ? 'memory' : 'memories'}`;
  const instructionsSummary = (() => {
    if (counts.instructionsLength === null) return '…';
    const len = counts.instructionsLength;
    const linked = counts.instructionsLinked ?? 0;
    if (len === 0 && linked === 0) return 'empty';
    const parts: string[] = [];
    if (len > 0) parts.push(`${len} chars`);
    if (linked > 0) parts.push(`${linked} prompt${linked === 1 ? '' : 's'}`);
    return parts.join(' · ');
  })();

  const settingsModal = (
    <WorkspaceModal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Workspace settings"
      size="md"
    >
      {workspace ? (
        <SettingsTab workspace={workspace} />
      ) : (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle size={20} className="animate-spin text-accent" />
        </div>
      )}
    </WorkspaceModal>
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
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1.5 rounded-control hover:bg-surface-2 transition text-fg/60"
              title="Expand sidebar"
            >
              <PanelRightOpen size={16} />
            </button>
            <Link
              href={`/workspaces/${workspaceId}/c/new`}
              className="p-1.5 rounded-control bg-accent hover:bg-accent-700 transition-colors duration-150 text-accent-fg"
              title="New chat"
            >
              <Plus size={16} />
            </Link>
          </div>

          <div className="mt-auto pb-4">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded-control hover:bg-surface-2 transition text-fg/60"
              title="Workspace settings"
            >
              <SettingsIcon size={16} />
            </button>
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
            <Link
              href={`/workspaces/${workspaceId}/c/new`}
              className="p-2 rounded-control bg-accent hover:bg-accent-700 transition-colors duration-150 text-accent-fg"
              title="New chat"
            >
              <Plus size={17} />
            </Link>

            <div className="flex gap-2 items-center">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="p-2 rounded-control hover:bg-surface-2 transition text-fg/60"
                title="Workspace settings"
              >
                <SettingsIcon size={17} />
              </button>
              <button
                type="button"
                onClick={onToggleCollapse}
                className="p-2 rounded-control hover:bg-surface-2 transition text-fg/60"
                title="Collapse sidebar"
              >
                <PanelRightClose size={17} />
              </button>
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
                onOpenFile={(id) => setOpenFileId(id)}
                onCountChange={(n) => setCounts((c) => ({ ...c, files: n }))}
              />
            </CollapsibleSection>

            <CollapsibleSection
              icon={Link2}
              title="Sources"
              summary={sourcesSummary}
              open={open.sources}
              onToggle={() => toggle('sources')}
            >
              <UrlsTab
                workspaceId={workspaceId}
                compact
                onCountChange={(n) => setCounts((c) => ({ ...c, sources: n }))}
              />
            </CollapsibleSection>

            <CollapsibleSection
              icon={BookOpen}
              title="Instructions"
              summary={instructionsSummary}
              open={open.instructions}
              onToggle={() => toggle('instructions')}
            >
              <InstructionsTab
                workspaceId={workspaceId}
                onSummaryChange={({ length, linkedCount }) =>
                  setCounts((c) => ({
                    ...c,
                    instructionsLength: length,
                    instructionsLinked: linkedCount,
                  }))
                }
              />
            </CollapsibleSection>

            <CollapsibleSection
              icon={Brain}
              title="Memory"
              summary={memorySummary}
              open={open.memory}
              onToggle={() => toggle('memory')}
            >
              <WorkspaceMemoryTab
                workspaceId={workspaceId}
                compact
                onCountChange={(n) => setCounts((c) => ({ ...c, memory: n }))}
              />
            </CollapsibleSection>
          </div>

          <WorkspaceModal
            open={!!openFileId}
            onClose={() => setOpenFileId(null)}
            title="File"
            size="lg"
          >
            {openFileId && (
              <FileViewer workspaceId={workspaceId} fileId={openFileId} />
            )}
          </WorkspaceModal>
        </aside>
      )}

      {settingsModal}
    </>
  );
}
