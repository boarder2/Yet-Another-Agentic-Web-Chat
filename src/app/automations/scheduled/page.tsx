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
import { Button, buttonClasses } from '@/components/ui/Button';
import { describeCron } from '@/lib/scheduledTasks/presets';
import { formatTimeDifference } from '@/lib/utils';
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
  const [toDelete, setToDelete] = useState<string | null>(null);

  const toggle = (s: ScheduleListItem) =>
    patch.mutate({ id: s.id, data: { enabled: s.enabled ? 0 : 1 } });

  return (
    <div>
      <PageHeader icon={CalendarClock} title="Scheduled Tasks" />

      {isLoading && (
        <div className="flex items-center justify-center min-h-[50vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!isLoading && schedules.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-fg/60">
          <CalendarClock size={48} className="mb-4 opacity-50" />
          <p className="text-lg mb-2">No schedules</p>
          <p className="text-sm mb-4">
            Add a schedule from a workflow to run it on a cron.
          </p>
          <Link href="/automations" className={buttonClasses('primary', 'md')}>
            Go to Workflows
          </Link>
        </div>
      )}

      {!isLoading && schedules.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {schedules.map((s, i) => (
            <div
              key={s.id}
              data-schedule-id={s.id}
              className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-5 ${
                i !== schedules.length - 1 ? 'border-b border-surface-2' : ''
              }`}
            >
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-lg truncate">
                    {s.label}
                  </span>
                  <span className="text-sm text-fg/50 truncate">
                    {s.workflowName}
                  </span>
                  {s.running && (
                    <LoaderCircle
                      size={12}
                      className="animate-spin text-accent shrink-0"
                    />
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-fg/60 flex-wrap">
                  <span>{describeCron(s.cronExpression)}</span>
                  {s.lastRunAt && (
                    <span className="flex items-center gap-1">
                      {s.lastRunStatus === 'success' ? (
                        <CheckCircle size={12} className="text-success" />
                      ) : s.lastRunStatus === 'error' ? (
                        <XCircle size={12} className="text-danger" />
                      ) : null}
                      Last run{' '}
                      {formatTimeDifference(new Date(), new Date(s.lastRunAt))}{' '}
                      ago
                    </span>
                  )}
                  {s.lastRunChatId ? (
                    <Link
                      href={`/c/${s.lastRunChatId}`}
                      className="text-accent hover:underline"
                    >
                      Open last run
                    </Link>
                  ) : null}
                  {s.disabledReason && (
                    <span className="text-warning">{s.disabledReason}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  className={`px-3 py-1 rounded-pill text-xs font-medium transition-colors duration-150 ${
                    s.enabled
                      ? 'bg-success-soft text-success border border-success'
                      : 'bg-surface-2 text-fg/50 border border-surface-2'
                  }`}
                >
                  {s.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button
                  type="button"
                  onClick={() => run.mutate(s.id)}
                  disabled={run.isPending || s.running}
                  className="p-1.5 rounded-control hover:bg-surface-2 transition-colors duration-150 text-fg/60 hover:text-fg disabled:opacity-40"
                  title="Run now"
                >
                  <Play size={16} />
                </button>
                <Link
                  href={`/automations/schedules/${s.id}`}
                  className="p-1.5 rounded-control hover:bg-surface-2 transition-colors duration-150 text-fg/60 hover:text-fg"
                  title="Edit"
                >
                  <Pencil size={16} />
                </Link>
                {toDelete === s.id ? (
                  <span className="flex items-center gap-1">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() =>
                        del.mutate(s.id, {
                          onSettled: () => setToDelete(null),
                        })
                      }
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setToDelete(null)}
                      className="text-fg/60"
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setToDelete(s.id)}
                    className="p-1.5 rounded-control hover:bg-surface-2 transition-colors duration-150 text-fg/60 hover:text-danger"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
