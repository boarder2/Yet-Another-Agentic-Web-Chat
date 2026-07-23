'use client';

import PageHeader from '@/components/PageHeader';
import { cn, formatTimeDifference } from '@/lib/utils';
import {
  AlertCircle,
  CalendarClock,
  ClockIcon,
  Globe,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Settings2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useScheduleRunsList } from '@/lib/hooks/api/useSchedules';

const focusModeIcons: Record<string, React.ReactNode> = {
  webSearch: <Globe size={14} className="text-accent" />,
  chat: <MessageCircle size={14} className="text-info" />,
  localResearch: <Pencil size={14} className="text-accent" />,
};

export default function ScheduledRunsPage() {
  const router = useRouter();
  const { data: runs = [], isLoading: loading } = useScheduleRunsList(50);

  return (
    <div>
      <PageHeader
        icon={CalendarClock}
        title="Scheduled Tasks"
        actions={
          <Link
            href="/automations/scheduled/manage"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-surface-2 hover:bg-surface-2/80 text-sm transition-colors duration-150"
          >
            <Settings2 size={14} />
            Manage schedules
          </Link>
        }
      />

      {loading && (
        <div className="flex items-center justify-center min-h-[50vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!loading && runs.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-fg/60">
          <CalendarClock size={48} className="mb-4 opacity-50" />
          <p className="text-lg mb-2">No scheduled runs yet</p>
          <p className="text-sm mb-4">
            Add a schedule to a workflow to generate reports automatically.
          </p>
          <Link
            href="/automations/scheduled/manage"
            className="flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent text-accent-fg text-sm transition-colors duration-150 hover:bg-accent-700"
          >
            <Settings2 size={14} />
            Manage schedules
          </Link>
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {runs.map((run, i) => (
            <div
              key={run.id}
              onClick={() => router.push(`/c/${run.id}`)}
              className={cn(
                'flex flex-col space-y-3 py-5 cursor-pointer',
                i !== runs.length - 1 ? 'border-b border-surface-2' : '',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="lg:text-xl font-medium truncate">
                  {run.workflowName}
                </span>
                <span className="text-sm text-fg/50 truncate">
                  {run.scheduleLabel}
                </span>
                {run.activeRunMessageId ? (
                  <span className="flex items-center gap-1 text-accent text-xs shrink-0">
                    <LoaderCircle size={12} className="animate-spin" />
                    Running…
                  </span>
                ) : (
                  run.scheduledRunViewed === 0 && (
                    <span className="w-2.5 h-2.5 rounded-pill bg-accent shrink-0" />
                  )
                )}
                {run.lastRunStatus === 'error' && (
                  <AlertCircle size={14} className="text-danger shrink-0" />
                )}
              </div>
              {run.preview && (
                <p className="text-sm text-fg/60 line-clamp-2">{run.preview}</p>
              )}
              <div className="flex items-center gap-3 text-xs opacity-70">
                <span className="flex items-center gap-1.5">
                  {focusModeIcons[run.focusMode] || <Globe size={14} />}
                  <ClockIcon size={13} />
                  {new Date(run.createdAt).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  <span className="opacity-70">
                    ({formatTimeDifference(new Date(), new Date(run.createdAt))}{' '}
                    ago)
                  </span>
                </span>
                {run.sourcesCount > 0 && (
                  <span>{run.sourcesCount} sources</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
