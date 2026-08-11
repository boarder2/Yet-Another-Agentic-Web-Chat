'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/ui/Modal';
import { Button, buttonClasses } from '@/components/ui/Button';
import {
  ListCount,
  ListRow,
  ListRowAction,
  listRowActionClasses,
} from '@/components/ui/List';
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
    <Modal open onClose={onClose} title={`Run “${workflow.name}”`}>
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
    </Modal>
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
    <Modal
      open
      onClose={onClose}
      title={`Delete “${workflow.name}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="text-fg/60">
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={del.isPending}
            onClick={async () => {
              await del.mutateAsync(workflow.id);
              onClose();
            }}
          >
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
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
    </Modal>
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
            className={buttonClasses('primary', 'md')}
          >
            <Plus size={16} />
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
            className={buttonClasses('primary', 'md')}
          >
            <Plus size={16} />
            Create your first workflow
          </Link>
        </div>
      )}

      {!isLoading && workflows.length > 0 && (
        <>
          <ListCount>
            {workflows.length} workflow{workflows.length === 1 ? '' : 's'}
          </ListCount>
          <div className="flex flex-col pb-20 lg:pb-2">
            {workflows.map((w) => (
              <ListRow
                key={w.id}
                data-workflow-id={w.id}
                href={`/automations/workflows/${w.id}`}
                leading={
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent/10 text-accent">
                    <DynamicIcon name={w.icon} size={18} />
                  </div>
                }
                title={w.name}
                body={
                  <p className="h-5 overflow-hidden text-sm leading-5 text-fg/60 line-clamp-1">
                    {w.description ?? ''}
                  </p>
                }
                actions={
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={Play}
                      onClick={() => setLaunch(w)}
                    >
                      Run
                    </Button>
                    <Link
                      href={`/automations/schedules/new?workflow=${w.id}`}
                      className={listRowActionClasses()}
                      title="Add schedule"
                      aria-label="Schedule"
                    >
                      <CalendarClock size={15} />
                    </Link>
                    <Link
                      href={`/automations/workflows/${w.id}`}
                      className={listRowActionClasses()}
                      title="Edit"
                      aria-label="Edit"
                    >
                      <Pencil size={15} />
                    </Link>
                    <ListRowAction
                      icon={Trash2}
                      label="Delete"
                      danger
                      onClick={() => setToDelete(w)}
                    />
                  </>
                }
              />
            ))}
          </div>
        </>
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
