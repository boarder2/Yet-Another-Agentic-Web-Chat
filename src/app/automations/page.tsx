'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import WorkspaceModal from '@/components/Workspaces/WorkspaceModal';
import DynamicIcon from '@/components/workflows/DynamicIcon';
import FillForm from '@/components/workflows/FillForm';
import {
  useWorkflows,
  useRunWorkflow,
  useDeleteWorkflow,
  type Workflow,
} from '@/lib/hooks/api/useWorkflows';
import { useWorkflowSchedules } from '@/lib/hooks/api/useSchedules';

function LaunchModal({
  workflow,
  onClose,
}: {
  workflow: Workflow;
  onClose: () => void;
}) {
  const router = useRouter();
  const run = useRunWorkflow(workflow.id);
  const [error, setError] = useState('');

  return (
    <WorkspaceModal open onClose={onClose} title={`Run “${workflow.name}”`}>
      {error && (
        <div className="mb-4 px-4 py-2 rounded-surface bg-danger-soft border border-danger text-danger text-sm">
          {error}
        </div>
      )}
      <FillForm
        prompt={workflow.prompt}
        submitLabel={run.isPending ? 'Starting…' : 'Run'}
        submitting={run.isPending}
        onSubmit={async (values) => {
          setError('');
          try {
            const { chatId } = await run.mutateAsync(values);
            router.push(`/c/${chatId}`);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : 'Failed to start run',
            );
          }
        }}
      />
    </WorkspaceModal>
  );
}

function DeleteModal({
  workflow,
  onClose,
}: {
  workflow: Workflow;
  onClose: () => void;
}) {
  const { data: schedules = [], isLoading } = useWorkflowSchedules(workflow.id);
  const del = useDeleteWorkflow();

  return (
    <WorkspaceModal open onClose={onClose} title={`Delete “${workflow.name}”`}>
      <p className="text-sm text-fg/70 mb-3">
        This permanently deletes the workflow. Past run chats are kept.
      </p>
      {isLoading ? (
        <LoaderCircle size={20} className="animate-spin text-accent" />
      ) : schedules.length > 0 ? (
        <div className="mb-4">
          <p className="text-sm font-medium text-warning mb-2">
            {schedules.length} schedule
            {schedules.length === 1 ? '' : 's'} will also be deleted:
          </p>
          <ul className="flex flex-col gap-1">
            {schedules.map((s) => (
              <li key={s.id} className="text-sm text-fg/70">
                • {s.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={del.isPending}
          onClick={async () => {
            await del.mutateAsync(workflow.id);
            onClose();
          }}
          className="px-5 py-2 rounded-control bg-danger text-danger-fg font-medium transition-colors duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {del.isPending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-control text-fg/60 hover:text-fg transition-colors duration-150"
        >
          Cancel
        </button>
      </div>
    </WorkspaceModal>
  );
}

export default function WorkflowsPage() {
  const { data: workflows = [], isLoading } = useWorkflows();
  const [launch, setLaunch] = useState<Workflow | null>(null);
  const [toDelete, setToDelete] = useState<Workflow | null>(null);

  return (
    <div>
      <PageHeader
        icon={WorkflowIcon}
        title="Workflows"
        actions={
          <Link
            href="/automations/workflows/new"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent text-accent-fg text-sm transition-colors duration-150 hover:bg-accent-700"
          >
            <Plus size={14} />
            New workflow
          </Link>
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center min-h-[40vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!isLoading && workflows.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-fg/60">
          <WorkflowIcon size={48} className="mb-4 opacity-50" />
          <p className="text-lg mb-2">No workflows yet</p>
          <p className="text-sm mb-4">
            Build a reusable, parameterized prompt to get started.
          </p>
          <Link
            href="/automations/workflows/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent text-accent-fg text-sm transition-colors duration-150 hover:bg-accent-700"
          >
            <Plus size={14} />
            Create your first workflow
          </Link>
        </div>
      )}

      {!isLoading && workflows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20 lg:pb-2">
          {workflows.map((w) => (
            <div
              key={w.id}
              onClick={() => setLaunch(w)}
              className="group flex flex-col gap-3 p-4 rounded-surface border border-surface-2 bg-surface cursor-pointer transition-colors duration-150 hover:border-accent"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center justify-center w-9 h-9 rounded-control bg-accent/10 text-accent shrink-0">
                    <DynamicIcon name={w.icon} size={18} />
                  </div>
                  <span className="font-medium truncate">{w.name}</span>
                </div>
                {w.running && (
                  <LoaderCircle
                    size={14}
                    className="animate-spin text-accent shrink-0"
                  />
                )}
              </div>
              {w.description && (
                <p className="text-sm text-fg/60 line-clamp-2">
                  {w.description}
                </p>
              )}
              <div
                className="flex items-center gap-1 mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                <Link
                  href={`/automations/schedules/new?workflow=${w.id}`}
                  className="p-1.5 rounded-control hover:bg-surface-2 text-fg/60 hover:text-fg transition-colors duration-150"
                  title="Add schedule"
                >
                  <CalendarClock size={16} />
                </Link>
                <Link
                  href={`/automations/workflows/${w.id}`}
                  className="p-1.5 rounded-control hover:bg-surface-2 text-fg/60 hover:text-fg transition-colors duration-150"
                  title="Edit"
                >
                  <Pencil size={16} />
                </Link>
                <button
                  type="button"
                  onClick={() => setToDelete(w)}
                  className="p-1.5 rounded-control hover:bg-surface-2 text-fg/60 hover:text-danger transition-colors duration-150"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {launch && (
        <LaunchModal workflow={launch} onClose={() => setLaunch(null)} />
      )}
      {toDelete && (
        <DeleteModal workflow={toDelete} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}
