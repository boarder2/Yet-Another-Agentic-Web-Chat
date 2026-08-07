'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  CheckCircle,
  LoaderCircle,
  Pencil,
  Play,
  Trash2,
  XCircle,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import {
  ListCount,
  ListEmptyState,
  ListLoading,
  ListRow,
  ListRowAction,
  listRowActionClasses,
} from '@/components/ui/List';
import { describeCron } from '@/lib/scheduledTasks/presets';
import { cn, formatTimeDifference } from '@/lib/utils';
import {
  useSchedules,
  usePatchSchedule,
  useDeleteSchedule,
  useRunSchedule,
  type ScheduleListItem,
} from '@/lib/hooks/api/useSchedules';

export default function ScheduledTasksPage() {
  const { data: schedules = [], isLoading } = useSchedules();
  const patch = usePatchSchedule();
  const del = useDeleteSchedule();
  const run = useRunSchedule();
  const [toDelete, setToDelete] = useState<ScheduleListItem | null>(null);

  const toggle = (s: ScheduleListItem) =>
    patch.mutate({ id: s.id, data: { enabled: s.enabled ? 0 : 1 } });

  return (
    <div>
      <PageHeader icon={CalendarClock} title="Scheduled Tasks" />

      {isLoading && <ListLoading />}

      {!isLoading && schedules.length === 0 && (
        <ListEmptyState>
          No schedules yet. Add one from a{' '}
          <Link href="/automations" className="text-accent hover:underline">
            workflow
          </Link>
          .
        </ListEmptyState>
      )}

      {!isLoading && schedules.length > 0 && (
        <>
          <ListCount>
            {schedules.length} schedule{schedules.length === 1 ? '' : 's'}
          </ListCount>
          <div className="flex flex-col pb-20 lg:pb-2">
            {schedules.map((s) => (
              <ListRow
                key={s.id}
                data-schedule-id={s.id}
                title={s.label}
                meta={
                  <>
                    {s.running && (
                      <span className="flex items-center gap-1.5">
                        <LoaderCircle
                          size={13}
                          className="animate-spin text-accent"
                        />
                        Running
                      </span>
                    )}
                    <span>{s.workflowName}</span>
                    <span>{describeCron(s.cronExpression)}</span>
                    {s.lastRunAt && (
                      <span className="flex items-center gap-1.5">
                        {s.lastRunStatus === 'success' ? (
                          <CheckCircle size={13} className="text-success" />
                        ) : s.lastRunStatus === 'error' ? (
                          <XCircle size={13} className="text-danger" />
                        ) : null}
                        Last run{' '}
                        {formatTimeDifference(
                          new Date(),
                          new Date(s.lastRunAt),
                        )}{' '}
                        ago
                      </span>
                    )}
                    {s.lastRunChatId && (
                      <Link
                        href={`/c/${s.lastRunChatId}`}
                        className="text-accent hover:underline"
                      >
                        Open last run
                      </Link>
                    )}
                    {s.disabledReason && (
                      <span className="text-warning">{s.disabledReason}</span>
                    )}
                  </>
                }
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => toggle(s)}
                      className={cn(
                        'rounded-pill border px-3 py-1 text-xs font-medium transition-colors duration-150',
                        s.enabled
                          ? 'bg-success-soft text-success border-success'
                          : 'bg-surface-2 text-fg/50 border-surface-2',
                      )}
                    >
                      {s.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <ListRowAction
                      icon={Play}
                      label="Run now"
                      disabled={run.isPending || s.running}
                      onClick={() => run.mutate(s.id)}
                    />
                    <Link
                      href={`/automations/schedules/${s.id}`}
                      title="Edit"
                      aria-label="Edit"
                      className={listRowActionClasses()}
                    >
                      <Pencil size={15} />
                    </Link>
                    <ListRowAction
                      icon={Trash2}
                      label="Delete"
                      danger
                      onClick={() => setToDelete(s)}
                    />
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        size="sm"
        title="Delete schedule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() =>
                toDelete &&
                del.mutate(toDelete.id, { onSettled: () => setToDelete(null) })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg/70">
          Delete <span className="font-medium">{toDelete?.label}</span>? Past
          run chats are kept.
        </p>
      </Modal>
    </div>
  );
}
