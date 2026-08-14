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
import { IconButton } from '@/components/ui/IconButton';
import ConfirmModal from '@/components/ui/ConfirmModal';
import {
  ListCount,
  ListEmptyState,
  ListLoading,
  ListRow,
} from '@/components/ui/List';
import { describeCron } from '@/lib/scheduledTasks/presets';
import { formatTimeDifference } from '@/lib/utils';
import { FilterChip } from '@/components/ui/FilterChip';
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

      {isLoading && <ListLoading layout="page" size={32} />}

      {!isLoading && schedules.length === 0 && (
        <ListEmptyState layout="page">
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
                    <FilterChip
                      selected={Boolean(s.enabled)}
                      tint="bg-success-soft border-success text-success"
                      onClick={() => toggle(s)}
                    >
                      {s.enabled ? 'Enabled' : 'Disabled'}
                    </FilterChip>
                    <IconButton
                      icon={Play}
                      label="Run now"
                      loading={run.isPending}
                      disabled={s.running}
                      onClick={() => run.mutate(s.id)}
                    />
                    <IconButton
                      href={`/automations/schedules/${s.id}`}
                      icon={Pencil}
                      label="Edit"
                    />
                    <IconButton
                      icon={Trash2}
                      label="Delete"
                      tone="danger"
                      onClick={() => setToDelete(s)}
                    />
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete schedule"
        body={
          <p>
            Delete <span className="font-medium">{toDelete?.label}</span>? Past
            run chats are kept.
          </p>
        }
        loading={del.isPending}
        onConfirm={() => {
          if (!toDelete) return;
          del.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
        }}
      />
    </div>
  );
}
