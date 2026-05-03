'use client';

import PageHeader from '@/components/PageHeader';
import { cn, formatTimeDifference } from '@/lib/utils';
import {
  CalendarClock,
  ClockIcon,
  Globe,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Settings2,
  Plus,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Run {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  scheduledTaskId: string | null;
  scheduledRunViewed: number | null;
  taskName: string;
  lastRunStatus: string | null;
  preview: string;
  sourcesCount: number;
}

const focusModeIcons: Record<string, React.ReactNode> = {
  webSearch: <Globe size={14} className="text-accent" />,
  chat: <MessageCircle size={14} className="text-[#10B981]" />,
  localResearch: <Pencil size={14} className="text-[#8B5CF6]" />,
};

const Page = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const res = await fetch('/api/scheduled-tasks/runs?limit=50');
        if (res.ok) {
          const data = await res.json();
          setRuns(data);
        }
      } catch {
        // Ignore
      } finally {
        setLoading(false);
      }
    };
    fetchRuns();
  }, []);

  return (
    <div>
      <PageHeader
        icon={CalendarClock}
        title="Scheduled Tasks"
        actions={
          <>
            <Link
              href="/scheduled-tasks/manage"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-surface bg-surface-2 hover:bg-surface-2/80 text-sm transition duration-200"
            >
              <Settings2 size={14} />
              Manage tasks
            </Link>
            <Link
              href="/scheduled-tasks/new"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-surface bg-accent text-accent-fg text-sm transition duration-200 hover:opacity-90"
            >
              <Plus size={14} />
              New task
            </Link>
          </>
        }
      />

      {loading && (
        <div className="flex flex-row items-center justify-center min-h-[50vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!loading && runs.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-fg/60">
          <CalendarClock size={48} className="mb-4 opacity-50" />
          <p className="text-lg mb-2">No scheduled runs yet</p>
          <p className="text-sm mb-4">
            Create a scheduled task to automatically generate reports.
          </p>
          <Link
            href="/scheduled-tasks/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-surface bg-accent text-accent-fg text-sm transition duration-200 hover:opacity-90"
          >
            <Plus size={14} />
            Create your first task
          </Link>
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {runs.map((run, i) => (
            <div
              className={cn(
                'flex flex-col space-y-3 py-5 cursor-pointer',
                i !== runs.length - 1 ? 'border-b border-surface-2' : '',
              )}
              key={run.id}
              onClick={() => router.push(`/c/${run.id}`)}
            >
              <div className="flex items-center gap-2">
                <span className="lg:text-xl font-medium truncate">
                  {run.taskName}
                </span>
                {run.scheduledRunViewed === 0 && (
                  <span className="w-2.5 h-2.5 rounded-pill bg-accent shrink-0" />
                )}
                {run.lastRunStatus === 'error' && (
                  <AlertCircle size={14} className="text-danger shrink-0" />
                )}
              </div>
              {run.preview && (
                <p className="text-sm text-fg/60 line-clamp-2">{run.preview}</p>
              )}
              <div className="flex flex-row items-center gap-3 text-xs opacity-70">
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
};

export default Page;
