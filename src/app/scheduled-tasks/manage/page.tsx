'use client';

import { formatTimeDifference } from '@/lib/utils';
import { describeCron } from '@/lib/scheduledTasks/presets';
import {
  CalendarClock,
  LoaderCircle,
  Plus,
  Play,
  Pencil,
  Trash2,
  ArrowLeft,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  useScheduledTasks,
  usePatchScheduledTask,
  useDeleteScheduledTask,
  useRunScheduledTask,
  type ScheduledTask,
} from '@/lib/hooks/api/useScheduledTasks';

const Page = () => {
  const router = useRouter();
  const { data: tasks = [], isLoading: loading } = useScheduledTasks();
  const patchTask = usePatchScheduledTask();
  const deleteTask = useDeleteScheduledTask();
  const runTask = useRunScheduledTask();
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  const toggleEnabled = (task: ScheduledTask) => {
    patchTask.mutate({ id: task.id, data: { enabled: !task.enabled } });
  };

  const runNow = (task: ScheduledTask) => {
    setRunningTaskId(task.id);
    runTask.mutate(task.id, {
      onSuccess: (data: unknown) => {
        const d = data as { chatId?: string } | undefined;
        if (d?.chatId) router.push(`/c/${d.chatId}`);
      },
      onSettled: () => setRunningTaskId(null),
    });
  };

  const handleDelete = (task: ScheduledTask) => {
    if (!confirm(`Delete task "${task.name}"?`)) return;
    deleteTask.mutate(task.id);
  };

  return (
    <div className="flex flex-col pt-4">
      <div className="flex items-center justify-between px-1 mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/scheduled-tasks"
            className="text-fg/60 hover:text-fg transition"
          >
            <ArrowLeft size={20} />
          </Link>
          <CalendarClock />
          <h2 className="text-3xl font-medium">Manage Tasks</h2>
        </div>
        <Link
          href="/scheduled-tasks/new"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-surface bg-accent text-accent-fg text-sm transition duration-200 hover:opacity-90"
        >
          <Plus size={14} />
          New task
        </Link>
      </div>

      {loading && (
        <div className="flex flex-row items-center justify-center min-h-[50vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-fg/60">
          <CalendarClock size={48} className="mb-4 opacity-50" />
          <p className="text-lg mb-2">No scheduled tasks</p>
          <p className="text-sm mb-4">Create a task to get started.</p>
          <Link
            href="/scheduled-tasks/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-surface bg-accent text-accent-fg text-sm transition duration-200 hover:opacity-90"
          >
            <Plus size={14} />
            Create task
          </Link>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {tasks.map((task, i) => {
            const isRunning = task.running || runningTaskId === task.id;
            return (
              <div
                className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-5 ${i !== tasks.length - 1 ? 'border-b border-surface-2' : ''}`}
                key={task.id}
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="font-medium text-lg truncate">
                    {task.name}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-fg/60">
                    {isRunning && (
                      <span className="flex items-center gap-1 text-accent">
                        <LoaderCircle size={12} className="animate-spin" />
                        Running…
                      </span>
                    )}
                    {(task.cronExpression || task.schedule) && (
                      <span>
                        {describeCron(
                          task.cronExpression ?? task.schedule ?? '',
                        )}
                      </span>
                    )}
                    {task.lastRunAt && (
                      <span className="flex items-center gap-1">
                        {task.lastRunStatus === 'success' ? (
                          <CheckCircle size={12} className="text-success" />
                        ) : task.lastRunStatus === 'error' ? (
                          <XCircle size={12} className="text-danger" />
                        ) : null}
                        Last run{' '}
                        {formatTimeDifference(
                          new Date(),
                          new Date(task.lastRunAt),
                        )}{' '}
                        ago
                      </span>
                    )}
                    {task.lastRunChatId ? (
                      <Link
                        href={`/c/${task.lastRunChatId}`}
                        className="text-xs text-accent hover:underline"
                      >
                        Open last run
                      </Link>
                    ) : task.lastRunAt ? (
                      <span className="text-xs text-fg/40 italic">
                        Chat no longer available
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(task)}
                    className={`px-3 py-1 rounded-pill text-xs font-medium transition ${
                      task.enabled
                        ? 'bg-success-soft text-success dark:text-success border border-success'
                        : 'bg-surface-2 text-fg/50 border border-surface-2'
                    }`}
                  >
                    {task.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    onClick={() => runNow(task)}
                    disabled={isRunning}
                    className="p-1.5 rounded-surface hover:bg-surface-2 transition text-fg/60 hover:text-fg disabled:opacity-50"
                    title="Run now"
                  >
                    {isRunning ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                  <Link
                    href={`/scheduled-tasks/manage/${task.id}/edit`}
                    className="p-1.5 rounded-surface hover:bg-surface-2 transition text-fg/60 hover:text-fg"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(task)}
                    className="p-1.5 rounded-surface hover:bg-surface-2 transition text-fg/60 hover:text-danger"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Page;
